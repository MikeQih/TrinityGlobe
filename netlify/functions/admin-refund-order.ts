import Stripe from "stripe";
import { getSupabaseAdmin } from "./_lib/supabase";
import { getStripe, refundFailureReason } from "./_lib/stripe";
import { jsonResponse, errorResponse } from "./_lib/responses";
import { adminRefundRequestSchema } from "./_lib/schemas";
import { corsHeaders, corsPreflightResponse } from "./_lib/cors";

interface RefundRequestRow {
  id: string;
  order_id: string;
  amount_cents: number;
}

// The four outcomes apply_refund_status can report back for the
// synchronous call this function makes right after refunds.create — see
// supabase/migrations/0022_refund_webhook_reconciliation.sql for the full
// state machine (webhook-driven calls can additionally see 'noop_stale',
// which can't happen here since this is always the *first* status this
// exact refund_request has ever been told about).
type ApplyOutcome =
  | "applied_pending"
  | "applied_requires_action"
  | "applied_failed"
  | "applied_succeeded"
  | "noop_already_succeeded"
  | "noop_already_failed"
  | "mismatch";

/**
 * POST { orderId, amountCents? } -> { ok, status, refundedCents?, orderStatus?, failureReason? }
 *
 * `status` is one of "succeeded" | "pending" | "requires_action" | "failed" —
 * never inferred from "did the HTTP call throw", always from Stripe's own
 * Refund.status (or, for a hard rejection, from the exception Stripe raised
 * instead of ever creating a Refund object). PayNow refunds routinely come
 * back "pending" — that used to be immediately (and wrongly) settled as
 * succeeded here; see PROJECT_STATUS.md's Restricted Key rehearsal writeup
 * for how that gap was found. It is never acceptable for this function's
 * response to claim "succeeded" for anything Stripe hasn't actually
 * confirmed — admin-app relies on `status` alone to decide what to show,
 * and the real ledger update only ever happens once, inside
 * apply_refund_status, whether it's this function or stripe-webhook.ts
 * that ends up being the one to report the terminal outcome.
 *
 * Called by admin-app (a separate deployed app, see admin-app/vite.config.ts)
 * to issue a Stripe refund. Runs server-side deliberately: the Stripe secret
 * key can never be shipped to a browser, so the refund itself can't be
 * called directly from admin-app's client code — only this Function holds
 * that key. Supabase RLS (see 0001_init.sql) governs what admin-app can read
 * directly from the database, but a write with real financial effect like
 * this gets an explicit role check here too, since this Function uses the
 * service_role key and therefore bypasses RLS entirely.
 *
 * Per PRD §7.6 ("已出库订单退款时不得自动恢复库存"), this does NOT touch
 * inventory — whether a refunded order's stock should be restocked is an
 * operational call for staff to make separately, since a refund doesn't by
 * itself mean the bottles never left the warehouse.
 *
 * Idempotency: claim_refund_request (see
 * supabase/migrations/0014_refund_request_ledger.sql) hands back a durable
 * row whose own id is used as the Stripe idempotency key — never a value
 * generated fresh per HTTP request. A network timeout, a page refresh, a
 * second admin-app tab, or two staff members clicking refund on the same
 * order all resolve to the *same* pending row (the RPC takes a row lock on
 * the order for the brief moment it decides that), so a retry reuses the
 * same key instead of minting a new one — exactly what Stripe's own docs
 * recommend when an outcome is ambiguous rather than confirmed-failed. A
 * retry while the previous attempt is still 'pending' or 'requires_action'
 * resumes the same row and passes the same idempotency key to Stripe again,
 * which returns the *same* Refund object rather than creating a second one.
 */
export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return errorResponse(405, "Method not allowed", undefined, corsHeaders());

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return errorResponse(401, "Missing authorization", undefined, corsHeaders());

  const supabase = getSupabaseAdmin();

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return errorResponse(401, "Invalid session", undefined, corsHeaders());
  }

  const { data: profile } = await supabase
    .from("admin_profiles")
    .select("role")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  // finance_readonly is exactly that — read-only. It must never be able to
  // move money, regardless of what state a refund ends up in.
  if (!profile || (profile.role !== "admin" && profile.role !== "ops")) {
    return errorResponse(403, "Not authorized to issue refunds", undefined, corsHeaders());
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body", undefined, corsHeaders());
  }
  const parsed = adminRefundRequestSchema.safeParse(body);
  if (!parsed.success) return errorResponse(400, "Invalid request", "validation_error", corsHeaders());
  const { orderId, amountCents } = parsed.data;

  const { data: claimed, error: claimError } = await supabase
    .rpc("claim_refund_request", {
      p_order_id: orderId,
      p_amount_cents: amountCents ?? null,
      p_created_by: userData.user.id,
    })
    .single<RefundRequestRow>();

  if (claimError || !claimed) {
    const msg = claimError?.message ?? "";
    if (msg.includes("order_not_found")) return errorResponse(404, "Order not found", "order_not_found", corsHeaders());
    if (msg.includes("no_payment")) return errorResponse(409, "Order has no payment to refund", "no_payment", corsHeaders());
    if (msg.includes("already_refunded")) {
      return errorResponse(409, "This order has already been fully refunded", "already_refunded", corsHeaders());
    }
    if (msg.includes("amount_too_large")) {
      return errorResponse(409, "Refund amount exceeds what's left to refund", "amount_too_large", corsHeaders());
    }
    if (msg.includes("pending_refund_amount_mismatch")) {
      return errorResponse(
        409,
        "A previous refund attempt on this order for a different amount hasn't resolved yet — check Stripe or try again in a moment",
        "pending_refund_conflict",
        corsHeaders()
      );
    }
    console.error("admin-refund-order: claim_refund_request failed", orderId, claimError);
    return errorResponse(500, "Failed to start refund", undefined, corsHeaders());
  }

  const { data: order } = await supabase
    .from("orders")
    .select("stripe_payment_intent_id")
    .eq("id", orderId)
    .single<{ stripe_payment_intent_id: string | null }>();

  if (!order?.stripe_payment_intent_id) {
    // Shouldn't happen — claim_refund_request already checked this — but
    // never call Stripe with a null payment_intent if it somehow does.
    console.error("admin-refund-order: claimed refund request but order has no payment_intent", orderId);
    return errorResponse(500, "Order has no payment to refund", undefined, corsHeaders());
  }

  const stripe = getStripe();
  let refund: Stripe.Refund;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: order.stripe_payment_intent_id,
        amount: claimed.amount_cents,
        // No PII — just the two ids needed for stripe-webhook.ts to find
        // this exact row without relying solely on stripe_refund_id
        // (which this same call is about to bind, but a crash between
        // Stripe creating the refund and that bind landing would otherwise
        // leave the eventual refund.updated/refund.failed event with
        // nothing else to key off).
        metadata: { refund_request_id: claimed.id, order_id: orderId },
      },
      { idempotencyKey: claimed.id }
    );
  } catch (err) {
    if (err instanceof Stripe.errors.StripeInvalidRequestError) {
      // A definitive rejection — Stripe never created a Refund object, so
      // there's nothing to bind. Straight to the terminal failed state.
      const { data: outcome } = await supabase.rpc("apply_refund_status", {
        p_refund_request_id: claimed.id,
        p_stripe_status: "failed",
        p_failure_reason: err.message,
        p_expected_order_id: orderId,
        p_expected_amount_cents: claimed.amount_cents,
      });
      console.error("admin-refund-order: refund rejected by Stripe", orderId, err.message, outcome as ApplyOutcome | null);
      return jsonResponse(
        502,
        { ok: false, status: "failed", error: err.message || "Refund failed at payment provider", code: "refund_failed" },
        corsHeaders()
      );
    }
    // Ambiguous outcome (network error, Stripe 5xx, timeout) — deliberately
    // left exactly as claim_refund_request left it (still 'pending' or
    // 'requires_action'): the true outcome is unknown, and per Stripe's own
    // guidance the safe move is to retry with the *same* idempotency key,
    // not assume failure and mint a new one.
    console.error("admin-refund-order: ambiguous Stripe outcome, leaving refund request pending for retry", orderId, claimed.id, err);
    return errorResponse(
      502,
      "Couldn't confirm whether the refund went through — please try again in a moment; retrying is safe and won't double-refund",
      "refund_outcome_unknown",
      corsHeaders()
    );
  }

  // Persist the linkage before interpreting the status at all — see the
  // migration's comment on bind_refund_stripe_id for why this is a
  // separate call rather than folded into apply_refund_status. A webhook
  // for this same refund can plausibly arrive and settle the row before
  // this call runs (Card refunds can resolve near-instantly); that's not
  // an error, it just means there's nothing left for this call to bind.
  try {
    await supabase.rpc("bind_refund_stripe_id", {
      p_refund_request_id: claimed.id,
      p_stripe_refund_id: refund.id,
      p_order_id: orderId,
      p_amount_cents: claimed.amount_cents,
    });
  } catch (err) {
    console.error("admin-refund-order: bind_refund_stripe_id failed (non-fatal — apply_refund_status below still runs)", orderId, claimed.id, refund.id, err);
  }

  const failureReason = refundFailureReason(refund);

  const { data: applyResult, error: applyError } = await supabase.rpc("apply_refund_status", {
    p_refund_request_id: claimed.id,
    p_stripe_status: refund.status,
    p_stripe_refund_id: refund.id,
    p_failure_reason: failureReason,
    p_expected_order_id: orderId,
    p_expected_amount_cents: claimed.amount_cents,
  });

  if (applyError || !applyResult) {
    console.error("admin-refund-order: apply_refund_status failed", orderId, claimed.id, refund.id, applyError);
    return errorResponse(500, "Refund was created at Stripe but its status couldn't be recorded — check the order manually", undefined, corsHeaders());
  }

  const outcome = applyResult as ApplyOutcome;
  if (outcome === "mismatch") {
    console.error("admin-refund-order: apply_refund_status reported a mismatch on a request this call just claimed", orderId, claimed.id, refund.id);
    return errorResponse(500, "Refund state could not be verified — check the order manually", undefined, corsHeaders());
  }

  if (outcome === "applied_succeeded" || outcome === "noop_already_succeeded") {
    const { data: updatedOrder } = await supabase
      .from("orders")
      .select("refunded_cents, status")
      .eq("id", orderId)
      .single<{ refunded_cents: number; status: string }>();
    return jsonResponse(
      200,
      { ok: true, status: "succeeded", refundedCents: updatedOrder?.refunded_cents, orderStatus: updatedOrder?.status },
      corsHeaders()
    );
  }

  if (outcome === "applied_failed" || outcome === "noop_already_failed") {
    return jsonResponse(
      502,
      { ok: false, status: "failed", failureReason: failureReason ?? "Refund failed at payment provider", code: "refund_failed" },
      corsHeaders()
    );
  }

  // applied_pending / applied_requires_action — the refund is genuinely
  // still in flight at Stripe (this is the normal, expected outcome for a
  // PayNow refund). Not an error: the request succeeded in starting or
  // continuing the refund, it just isn't final yet. admin-app must not
  // read `ok: true` here as "refund complete" — only `status` says that.
  return jsonResponse(
    200,
    { ok: true, status: outcome === "applied_requires_action" ? "requires_action" : "pending" },
    corsHeaders()
  );
};

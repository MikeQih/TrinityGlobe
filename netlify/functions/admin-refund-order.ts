import Stripe from "stripe";
import { getSupabaseAdmin } from "./_lib/supabase";
import { getStripe } from "./_lib/stripe";
import { jsonResponse, errorResponse } from "./_lib/responses";
import { adminRefundRequestSchema } from "./_lib/schemas";
import { corsHeaders, corsPreflightResponse } from "./_lib/cors";

interface RefundRequestRow {
  id: string;
  order_id: string;
  amount_cents: number;
  status: "pending" | "succeeded" | "failed";
}

/**
 * POST { orderId, amountCents? } -> { ok, refundedCents, status }
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
 * recommend when an outcome is ambiguous rather than confirmed-failed.
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
  try {
    const refund = await stripe.refunds.create(
      { payment_intent: order.stripe_payment_intent_id, amount: claimed.amount_cents },
      { idempotencyKey: claimed.id }
    );
    await supabase.rpc("settle_refund_request", {
      p_refund_request_id: claimed.id,
      p_outcome: "succeeded",
      p_stripe_refund_id: refund.id,
    });
  } catch (err) {
    // Only a definitive rejection from Stripe (the request itself was
    // invalid — bad amount, wrong currency, etc.) settles this request as
    // 'failed', freeing up a fresh attempt next time. Anything else —
    // a network error, a Stripe-side 5xx, a timeout — leaves the request
    // 'pending' on purpose: the true outcome is unknown, and per Stripe's
    // own guidance the safe move is to retry with the *same* idempotency
    // key, not assume failure and mint a new one.
    if (err instanceof Stripe.errors.StripeInvalidRequestError) {
      await supabase.rpc("settle_refund_request", {
        p_refund_request_id: claimed.id,
        p_outcome: "failed",
        p_failure_reason: err.message,
      });
      console.error("admin-refund-order: refund rejected by Stripe", orderId, err.message);
      return errorResponse(502, err.message || "Refund failed at payment provider", "refund_failed", corsHeaders());
    }
    console.error("admin-refund-order: ambiguous Stripe outcome, leaving refund request pending for retry", orderId, claimed.id, err);
    return errorResponse(
      502,
      "Couldn't confirm whether the refund went through — please try again in a moment; retrying is safe and won't double-refund",
      "refund_outcome_unknown",
      corsHeaders()
    );
  }

  const { data: updatedOrder } = await supabase
    .from("orders")
    .select("refunded_cents, status")
    .eq("id", orderId)
    .single<{ refunded_cents: number; status: string }>();

  return jsonResponse(
    200,
    { ok: true, refundedCents: updatedOrder?.refunded_cents, status: updatedOrder?.status },
    corsHeaders()
  );
};

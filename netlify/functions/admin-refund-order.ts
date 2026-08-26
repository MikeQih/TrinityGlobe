import { getSupabaseAdmin } from "./_lib/supabase";
import { getStripe } from "./_lib/stripe";
import { jsonResponse, errorResponse } from "./_lib/responses";
import { adminRefundRequestSchema } from "./_lib/schemas";
import { corsHeaders, corsPreflightResponse } from "./_lib/cors";

interface OrderRow {
  id: string;
  status: string;
  total_cents: number;
  refunded_cents: number;
  stripe_payment_intent_id: string | null;
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
  const { orderId, amountCents, idempotencyKey } = parsed.data;

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, total_cents, refunded_cents, stripe_payment_intent_id")
    .eq("id", orderId)
    .single<OrderRow>();

  if (orderError || !order) return errorResponse(404, "Order not found", undefined, corsHeaders());
  if (!order.stripe_payment_intent_id) {
    return errorResponse(409, "Order has no payment to refund", "no_payment", corsHeaders());
  }

  const remainingCents = order.total_cents - order.refunded_cents;
  if (remainingCents <= 0) {
    // Caught here instead of leaving it to Stripe: an omitted amountCents
    // (the "full refund" button) would otherwise resolve to
    // requestedCents=0, which Stripe rejects with a generic
    // parameter_invalid_integer — a confusing "Refund failed at payment
    // provider" for what's really just "there's nothing left to refund".
    return errorResponse(409, "This order has already been fully refunded", "already_refunded", corsHeaders());
  }
  const requestedCents = amountCents ?? remainingCents;
  if (requestedCents > remainingCents) {
    return errorResponse(409, "Refund amount exceeds what's left to refund", "amount_too_large", corsHeaders());
  }

  const stripe = getStripe();
  let refund;
  try {
    // idempotencyKey is generated client-side once per button click (see
    // OrderDetail.tsx#handleRefund), not derived from order state here —
    // deriving it from refunded_cents was tried first and had a real bug:
    // Stripe caches a *failed* response under its idempotency key for the
    // same 24h window as a successful one, so if a refund ever failed for
    // any reason (a transient Stripe error, a data mistake since fixed),
    // every retry with the same derived key would just replay the original
    // failure forever, since refunded_cents never changes when a refund
    // keeps failing. A fresh per-click key means a manual retry after
    // seeing an error is treated as a genuinely new attempt, while the
    // admin-app UI's disabled-while-refunding state (not this key) is what
    // guards against a true accidental double-click of the same click.
    refund = await stripe.refunds.create(
      {
        payment_intent: order.stripe_payment_intent_id,
        amount: requestedCents,
      },
      { idempotencyKey }
    );
  } catch (err) {
    console.error("admin-refund-order: stripe refund failed", orderId, err);
    return errorResponse(502, "Refund failed at payment provider", undefined, corsHeaders());
  }

  const newRefundedCents = order.refunded_cents + (refund.amount ?? requestedCents);
  const isFullRefund = newRefundedCents >= order.total_cents;

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      refunded_cents: newRefundedCents,
      status: isFullRefund ? "refunded" : order.status,
    })
    .eq("id", orderId);

  if (updateError) {
    // The refund already succeeded at Stripe — log loudly so staff can
    // reconcile refunded_cents by hand rather than silently under-recording it.
    console.error("admin-refund-order: refund succeeded at Stripe but order update failed", orderId, updateError);
  }

  return jsonResponse(
    200,
    { ok: true, refundedCents: newRefundedCents, status: isFullRefund ? "refunded" : order.status },
    corsHeaders()
  );
};

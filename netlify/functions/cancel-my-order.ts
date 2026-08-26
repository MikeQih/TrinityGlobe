import { z } from "zod";
import { getStripe } from "./_lib/stripe";
import { getSupabaseAdmin, getUserIdFromRequest } from "./_lib/supabase";
import { jsonResponse, errorResponse } from "./_lib/responses";

const requestSchema = z.object({ orderId: z.string().uuid() });

interface OrderRow {
  id: string;
  user_id: string | null;
  status: string;
  stripe_checkout_session_id: string | null;
}

/**
 * POST { orderId } — requires `Authorization: Bearer <supabase access token>`.
 *
 * Lets a customer cancel their own still-pending order from My Orders.
 *
 * Order of operations matters here and is deliberate: the Stripe session is
 * expired *before* the database is touched, not after. Expiring first and
 * using Stripe's own response as the "is this actually still cancellable"
 * check closes the exact race a customer-facing cancel button opens up —
 * without it, there'd be a window between "we decided to cancel" and "the
 * payment page stopped working" where the customer could still complete
 * payment on the old Payment Element while this site has already released
 * the stock back to the shelf. Once stripe.checkout.sessions.expire()
 * resolves successfully, Stripe guarantees that session can never accept a
 * payment again (the same guarantee release-expired-reservations.ts relies
 * on for the automatic-expiry path), so only *then* is it safe to release
 * inventory. If Stripe instead reports the session already completed, the
 * order is left untouched — it genuinely got paid in the gap between the
 * customer opening this page and clicking cancel, and the webhook (already
 * fired, or about to) is the only writer that's ever allowed to move an
 * order to paid/payment_review, so this function must not race it.
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const userId = await getUserIdFromRequest(req);
  if (!userId) return errorResponse(401, "Not signed in");

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await req.json());
  } catch {
    return errorResponse(400, "Invalid request", "validation_error");
  }

  const supabase = getSupabaseAdmin();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, user_id, status, stripe_checkout_session_id")
    .eq("id", body.orderId)
    .maybeSingle<OrderRow>();

  if (orderError) {
    console.error("cancel-my-order: failed to load order", body.orderId, orderError);
    return errorResponse(500, "Failed to load order");
  }
  if (!order || order.user_id !== userId) return errorResponse(404, "Order not found", "order_not_found");
  if (order.status !== "pending_payment") {
    return errorResponse(409, "This order is no longer awaiting payment", "order_not_pending");
  }

  if (order.stripe_checkout_session_id) {
    const stripe = getStripe();
    try {
      await stripe.checkout.sessions.expire(order.stripe_checkout_session_id);
    } catch (err) {
      // Stripe refuses to expire a session that's already complete — check
      // whether that's what happened here (vs. some transient API error)
      // before deciding how to respond.
      const session = await stripe.checkout.sessions
        .retrieve(order.stripe_checkout_session_id)
        .catch(() => null);
      if (session && (session.status === "complete" || session.payment_status === "paid")) {
        return errorResponse(
          409,
          "This order has already been paid and can no longer be cancelled",
          "already_paid"
        );
      }
      // Already expired on Stripe's side (the reservation TTL lapsed but
      // release-expired-reservations.ts hasn't run yet, or a previous
      // cancel attempt already closed it) — not payable either way, so
      // there's nothing more to protect against. Fall through and cancel.
      if (!session || session.status !== "expired") {
        console.error("cancel-my-order: failed to expire Stripe session", body.orderId, err);
        return errorResponse(502, "Failed to close the payment session — please try again", "stripe_error");
      }
    }
  }

  // Only reachable once the Stripe session is confirmed closed (or there
  // never was one) — safe to cancel and release stock now.
  const { data: result, error: rpcError } = await supabase.rpc("cancel_own_pending_order", {
    p_order_id: body.orderId,
    p_user_id: userId,
  });

  if (rpcError) {
    if (rpcError.message?.includes("order_not_found")) return errorResponse(404, "Order not found", "order_not_found");
    if (rpcError.message?.includes("not_order_owner")) return errorResponse(404, "Order not found", "order_not_found");
    console.error("cancel-my-order: cancel_own_pending_order failed", body.orderId, rpcError);
    return errorResponse(500, "Failed to cancel order");
  }

  if (result !== "cancelled") {
    // Status changed between our check above and the RPC's own row lock
    // (e.g. the webhook landed in between) — nothing left to do here.
    return errorResponse(409, "This order is no longer awaiting payment", "order_not_pending");
  }

  return jsonResponse(200, { status: "cancelled" });
};

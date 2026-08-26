import { z } from "zod";
import { getStripe } from "./_lib/stripe";
import { getSupabaseAdmin, getUserIdFromRequest } from "./_lib/supabase";
import { jsonResponse, errorResponse } from "./_lib/responses";

const requestSchema = z.object({ orderId: z.string().uuid() });

/**
 * POST { orderId } — requires `Authorization: Bearer <supabase access token>`.
 *
 * Lets a customer cancel their own still-pending order from My Orders.
 * cancel_own_pending_order (see supabase/migrations/0008_checkout_hardening.sql)
 * does the actual ownership check + status transition + reservation release
 * atomically; this Function's only other job is best-effort expiring the
 * Stripe session so the customer can't come back with the old payment link
 * and pay for an order this site has already put the stock back on the
 * shelf for.
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

  const { data: order } = await supabase
    .from("orders")
    .select("stripe_checkout_session_id")
    .eq("id", body.orderId)
    .maybeSingle<{ stripe_checkout_session_id: string | null }>();

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
    return errorResponse(409, "This order is no longer awaiting payment", "order_not_pending");
  }

  if (order?.stripe_checkout_session_id) {
    try {
      await getStripe().checkout.sessions.expire(order.stripe_checkout_session_id);
    } catch (err) {
      // Already completed/expired on Stripe's side, or some other transient
      // issue — the order is already cancelled here either way, so this is
      // just belt-and-braces against the old payment link still being usable.
      console.error("cancel-my-order: failed to expire Stripe session", body.orderId, err);
    }
  }

  return jsonResponse(200, { status: "cancelled" });
};

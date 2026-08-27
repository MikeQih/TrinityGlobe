import { z } from "zod";
import { getStripe } from "./_lib/stripe";
import { getSupabaseAdmin } from "./_lib/supabase";
import { jsonResponse, errorResponse } from "./_lib/responses";
import { corsHeaders, corsPreflightResponse } from "./_lib/cors";

const requestSchema = z.object({ orderId: z.string().uuid() });

/**
 * POST { orderId } -> { status: "cancelled" }
 *
 * Staff-initiated cancel of a still-pending order from admin-app. Same
 * admin/ops role check as admin-refund-order.ts, for the same reason: this
 * uses the service_role key and bypasses RLS, so the real authorization
 * check has to live here rather than in a client-side role check that a
 * modified request could just skip.
 *
 * Same ordering lesson as the customer-facing cancel-my-order.ts: the
 * Stripe session is expired *before* the database is touched, using
 * Stripe's own response as the "is this actually still cancellable" check.
 * Without that order, a customer could still complete payment on the old
 * Payment Element in the window between "we decided to cancel" and "the
 * payment page stopped working" — after the stock had already gone back
 * on the shelf.
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
    return errorResponse(403, "Not authorized to cancel orders", undefined, corsHeaders());
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body", undefined, corsHeaders());
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return errorResponse(400, "Invalid request", "validation_error", corsHeaders());

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, stripe_checkout_session_id")
    .eq("id", parsed.data.orderId)
    .maybeSingle<{ id: string; status: string; stripe_checkout_session_id: string | null }>();

  if (orderError) return errorResponse(500, "Failed to load order", undefined, corsHeaders());
  if (!order) return errorResponse(404, "Order not found", "order_not_found", corsHeaders());
  if (order.status !== "pending_payment") {
    return errorResponse(409, "This order is no longer awaiting payment", "order_not_pending", corsHeaders());
  }

  if (order.stripe_checkout_session_id) {
    const stripe = getStripe();
    try {
      await stripe.checkout.sessions.expire(order.stripe_checkout_session_id);
    } catch (err) {
      const session = await stripe.checkout.sessions
        .retrieve(order.stripe_checkout_session_id)
        .catch(() => null);
      if (session && (session.status === "complete" || session.payment_status === "paid")) {
        return errorResponse(409, "This order has already been paid and can no longer be cancelled", "already_paid", corsHeaders());
      }
      if (!session || session.status !== "expired") {
        console.error("admin-cancel-order: failed to expire Stripe session", parsed.data.orderId, err);
        return errorResponse(502, "Failed to close the payment session — please try again", "stripe_error", corsHeaders());
      }
    }
  }

  const { data: result, error: rpcError } = await supabase.rpc("cancel_pending_order_as_staff", {
    p_order_id: parsed.data.orderId,
  });

  if (rpcError) {
    console.error("admin-cancel-order: cancel_pending_order_as_staff failed", parsed.data.orderId, rpcError);
    return errorResponse(500, "Failed to cancel order", undefined, corsHeaders());
  }
  if (result !== "cancelled") {
    return errorResponse(409, "This order is no longer awaiting payment", "order_not_pending", corsHeaders());
  }

  return jsonResponse(200, { status: "cancelled" }, corsHeaders());
};

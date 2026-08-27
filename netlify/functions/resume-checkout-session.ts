import { z } from "zod";
import { getStripe } from "./_lib/stripe";
import { getSupabaseAdmin, getUserIdFromRequest } from "./_lib/supabase";
import { jsonResponse, errorResponse } from "./_lib/responses";
import { isCheckoutEnabled, checkoutDisabledResponse } from "./_lib/checkout-gate";

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
 * Re-opens the *same* order's *same* Stripe Checkout Session for a customer
 * who left the "继续付款" step (e.g. closed the tab) and came back from My
 * Orders. Deliberately never creates a new order or a new session — that
 * would double-reserve stock for the same cart. Ownership and liveness are
 * both re-checked here rather than trusted from the client:
 *   - the order must belong to the signed-in user (not just "some order id")
 *   - the order must still be pending_payment
 *   - the Stripe session itself must still report status "open" and
 *     payment_status "unpaid"
 *   - the session must not be past its own expires_at, even if Stripe's
 *     status field hasn't flipped to "expired" yet
 * A session reporting "complete"/"paid" is handled as its own case, not
 * folded into "not open" — see the note below on why marking an order
 * expired here would be actively dangerous if that's what happened.
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");
  if (!isCheckoutEnabled()) return checkoutDisabledResponse();

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
    console.error("resume-checkout-session: failed to load order", body.orderId, orderError);
    return errorResponse(500, "Failed to load order");
  }
  if (!order || order.user_id !== userId) return errorResponse(404, "Order not found", "order_not_found");
  if (order.status !== "pending_payment") {
    return errorResponse(409, "This order is no longer awaiting payment", "order_not_pending");
  }
  if (!order.stripe_checkout_session_id) {
    // The narrow "order created, session id not yet saved" window — nothing
    // to resume; the customer should retry the original checkout instead.
    return errorResponse(409, "No checkout session to resume", "no_session");
  }

  const stripe = getStripe();
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id);
  } catch (err) {
    console.error("resume-checkout-session: failed to retrieve Stripe session", order.id, err);
    return errorResponse(502, "Failed to check payment session status");
  }

  // Checked first, and never routed through mark_order_failed_from_webhook:
  // if Stripe says this session already collected payment, the order is
  // still sitting at pending_payment (we checked above) only because the
  // real webhook hasn't landed yet — calling the "expired" RPC here would
  // release inventory that's actually just been sold. Leave the order
  // alone and let the webhook (already fired, or about to) be the only
  // thing that ever writes a paid transition.
  if (session.status === "complete" || session.payment_status === "paid") {
    return errorResponse(409, "This order has already been paid", "already_paid");
  }

  const pastExpiry = session.expires_at != null && session.expires_at * 1000 <= Date.now();
  if (session.status !== "open" || pastExpiry) {
    const { error: rpcError } = await supabase.rpc("mark_order_failed_from_webhook", {
      p_order_id: order.id,
      p_new_status: "expired",
    });
    if (rpcError) {
      console.error("resume-checkout-session: mark_order_failed_from_webhook failed", order.id, rpcError);
    }
    return errorResponse(409, "This payment session has expired", "session_expired");
  }

  // Belt-and-braces: for a genuinely open, unexpired session this should
  // always already be "unpaid" — if it somehow isn't, don't guess, just
  // refuse to resume rather than mounting a Payment Element against a
  // session in a state this function doesn't understand.
  if (session.payment_status !== "unpaid") {
    return errorResponse(409, "This order can no longer be resumed", "not_resumable");
  }

  if (session.client_secret) {
    return jsonResponse(200, { mode: "elements", clientSecret: session.client_secret, orderId: order.id });
  }
  if (session.url) {
    return jsonResponse(200, { mode: "hosted", checkoutUrl: session.url, orderId: order.id });
  }
  console.error("resume-checkout-session: open session has neither client_secret nor url", order.id, session.id);
  return errorResponse(502, "Failed to resume checkout session");
};

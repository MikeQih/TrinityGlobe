import { getStripe } from "./_lib/stripe";
import { jsonResponse, errorResponse } from "./_lib/responses";

/**
 * GET ?session_id=cs_... -> { status, paymentStatus, orderId }
 *
 * Used only by the Payment Element return page (see src/cart.ts) to decide
 * what to show the customer immediately after a redirect back — e.g. a
 * PayNow QR code or a 3DS challenge. It is deliberately read-only: it never
 * touches `orders` or `inventory_reservations`. Whether the order actually
 * gets marked paid, its stock confirmed, and its emails sent is entirely
 * the Stripe webhook's job (stripe-webhook.ts) — this endpoint racing ahead
 * of the webhook, or never being called at all (e.g. the tab was closed),
 * must never be able to change what the order really is.
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return errorResponse(405, "Method not allowed");

  const sessionId = new URL(req.url).searchParams.get("session_id");
  if (!sessionId) return errorResponse(400, "Missing session_id");

  const stripe = getStripe();
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return jsonResponse(200, {
      status: session.status,
      paymentStatus: session.payment_status,
      orderId: (session.metadata?.order_id as string | undefined) ?? null,
    });
  } catch (err) {
    console.error("get-checkout-session-status: failed to retrieve session", sessionId, err);
    return errorResponse(502, "Failed to retrieve checkout session");
  }
};

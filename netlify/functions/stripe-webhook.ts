import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe } from "./_lib/stripe";
import { getSupabaseAdmin } from "./_lib/supabase";
import { requireEnv } from "./_lib/env";
import { errorResponse, jsonResponse } from "./_lib/responses";
import { sendOrderConfirmationEmail, sendStaffNotificationEmail, sendPaymentReviewAlertEmail } from "./_lib/email";

interface OrderRow {
  id: string;
  status: string;
  total_cents: number;
  recipient_snapshot: { name: string; phone: string; email: string; address: string; postalCode: string; notes: string };
  delivery_method: string;
  subtotal_cents: number;
  shipping_fee_cents: number;
  gst_cents: number;
  gst_registered_at_checkout: boolean;
  created_at: string;
  paid_at: string | null;
}

/**
 * Stripe webhook endpoint. Idempotent by construction: every event's id is
 * recorded in stripe_events *after* it's successfully handled, and a
 * redelivered event whose id is already there is a no-op. If handling
 * throws, we deliberately do NOT record the event, so Stripe's automatic
 * retry gets another chance — see https://docs.stripe.com/webhooks#retries.
 *
 * The actual order-status transitions live in Postgres RPCs
 * (mark_order_paid_from_webhook / mark_order_failed_from_webhook, see
 * 0008_checkout_hardening.sql) rather than here: "read current status, then
 * decide, then write" as three separate round-trips from this function
 * would leave a window for two concurrent webhook deliveries for the same
 * order to interleave. Each RPC does its status check, its reservation
 * confirm/release, and its status write as one locked transaction.
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const signature = req.headers.get("stripe-signature");
  if (!signature) return errorResponse(400, "Missing stripe-signature header");

  const payload = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, requireEnv("STRIPE_WEBHOOK_SECRET"));
  } catch (err) {
    console.error("stripe-webhook: signature verification failed", err);
    return errorResponse(400, "Invalid signature");
  }

  const supabase = getSupabaseAdmin();

  const { data: existing } = await supabase
    .from("stripe_events")
    .select("stripe_event_id")
    .eq("stripe_event_id", event.id)
    .maybeSingle();
  if (existing) {
    return jsonResponse(200, { received: true, deduped: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        await handlePaymentSucceeded(supabase, event.data.object as Stripe.Checkout.Session);
        break;
      }
      case "checkout.session.async_payment_failed": {
        await handlePaymentFailed(supabase, event.data.object as Stripe.Checkout.Session, "payment_failed");
        break;
      }
      case "checkout.session.expired": {
        // Distinct from a genuine decline — see the "已取消/支付已过期" vs
        // "付款失败" distinction on the My Orders page (src/orders-page.ts):
        // one means "try a different card", the other means "buy again".
        await handlePaymentFailed(supabase, event.data.object as Stripe.Checkout.Session, "expired");
        break;
      }
      default:
        break; // event type we don't act on — still recorded below so a resend of it is also a no-op
    }
  } catch (err) {
    console.error("stripe-webhook: handler failed for event", event.type, event.id, err);
    return errorResponse(500, "Webhook handling failed");
  }

  const { error: recordError } = await supabase
    .from("stripe_events")
    .insert({ stripe_event_id: event.id, event_type: event.type });
  if (recordError) {
    // Handling already succeeded above; failing to record the ledger row
    // just means a redelivery would re-run handling (safe, since the
    // handlers below are themselves idempotent via the RPCs' own status
    // checks).
    console.error("stripe-webhook: failed to record stripe_events row", event.id, recordError);
  }

  return jsonResponse(200, { received: true });
};

async function handlePaymentSucceeded(supabase: SupabaseClient, session: Stripe.Checkout.Session): Promise<void> {
  const orderId = session.client_reference_id ?? (session.metadata?.order_id as string | undefined);
  if (!orderId) {
    console.error("stripe-webhook: checkout session missing order_id", session.id);
    return;
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, total_cents")
    .eq("id", orderId)
    .single<Pick<OrderRow, "id" | "total_cents">>();

  if (orderError || !order) {
    console.error("stripe-webhook: order not found for session", session.id, orderId, orderError);
    return;
  }

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;

  // Belt-and-braces on top of create-checkout-session.ts always computing
  // the amount server-side: confirms Stripe actually collected what our own
  // database says this order costs, in the currency we expect. A mismatch
  // here is unusual enough (a bug in how the session was built, or the
  // order row changing between session creation and payment) that it isn't
  // something to silently paper over — but Stripe has genuinely taken the
  // customer's money either way, so this can't just be logged and dropped:
  // it needs a human to look at it, same as the RPC's own payment_review
  // outcome below.
  if (session.amount_total !== order.total_cents || session.currency !== "sgd") {
    console.error(
      "stripe-webhook: amount/currency mismatch, flagging for review",
      orderId,
      { sessionAmount: session.amount_total, sessionCurrency: session.currency, orderTotal: order.total_cents }
    );
    await supabase.from("orders").update({ status: "payment_review" }).eq("id", orderId).eq("status", "pending_payment");
    await sendPaymentReviewAlertEmail(orderId, "Stripe session amount/currency did not match the order total.");
    return;
  }

  const { data: result, error: rpcError } = await supabase.rpc("mark_order_paid_from_webhook", {
    p_order_id: orderId,
    p_payment_intent_id: paymentIntentId,
  });
  if (rpcError) {
    console.error("stripe-webhook: mark_order_paid_from_webhook failed", orderId, rpcError);
    return;
  }

  if (result === "payment_review") {
    console.error("stripe-webhook: order reached payment_review — paid on Stripe but wasn't pending_payment here", orderId);
    await sendPaymentReviewAlertEmail(orderId, "Stripe reported this payment succeeded, but the order was no longer pending payment.");
    return;
  }

  // 'already_paid' — a second event (e.g. both checkout.session.completed
  // and .async_payment_succeeded fired for the same session) landed here
  // after the first already sent the confirmation emails. Don't resend them.
  if (result !== "paid_now") return;

  const { data: fullOrder } = await supabase
    .from("orders")
    .select(
      "id, recipient_snapshot, delivery_method, subtotal_cents, shipping_fee_cents, total_cents, gst_cents, gst_registered_at_checkout, created_at, paid_at"
    )
    .eq("id", orderId)
    .single<OrderRow>();
  const { data: items } = await supabase
    .from("order_items")
    .select("name_snapshot, qty, line_total_cents")
    .eq("order_id", orderId);

  if (fullOrder) {
    await Promise.allSettled([
      sendOrderConfirmationEmail(fullOrder, items ?? []),
      sendStaffNotificationEmail(fullOrder, items ?? []),
    ]);
  }
}

async function handlePaymentFailed(
  supabase: SupabaseClient,
  session: Stripe.Checkout.Session,
  newStatus: "payment_failed" | "expired"
): Promise<void> {
  const orderId = session.client_reference_id ?? (session.metadata?.order_id as string | undefined);
  if (!orderId) return;

  // mark_order_failed_from_webhook only ever transitions an order that's
  // still pending_payment — if it's already paid (a checkout.session.expired
  // arriving after the completed event that paid it, since Stripe doesn't
  // guarantee delivery order across event types) or in any other terminal
  // state, this is a no-op that leaves it untouched.
  const { error: rpcError } = await supabase.rpc("mark_order_failed_from_webhook", {
    p_order_id: orderId,
    p_new_status: newStatus,
  });
  if (rpcError) {
    console.error("stripe-webhook: mark_order_failed_from_webhook failed", orderId, rpcError);
  }
}

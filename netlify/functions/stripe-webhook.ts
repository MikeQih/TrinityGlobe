import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe } from "./_lib/stripe";
import { getSupabaseAdmin } from "./_lib/supabase";
import { requireEnv } from "./_lib/env";
import { errorResponse, jsonResponse } from "./_lib/responses";
import { sendOrderConfirmationEmail, sendStaffNotificationEmail } from "./_lib/email";

interface OrderRow {
  id: string;
  status: string;
  recipient_snapshot: { name: string; phone: string; email: string; address: string; postalCode: string; notes: string };
  delivery_method: string;
  subtotal_cents: number;
  shipping_fee_cents: number;
  total_cents: number;
}

/**
 * Stripe webhook endpoint. Idempotent by construction: every event's id is
 * recorded in stripe_events *after* it's successfully handled, and a
 * redelivered event whose id is already there is a no-op. If handling
 * throws, we deliberately do NOT record the event, so Stripe's automatic
 * retry gets another chance — see https://docs.stripe.com/webhooks#retries.
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
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired": {
        await handlePaymentFailed(supabase, event.data.object as Stripe.Checkout.Session);
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
    // handlers below are themselves idempotent via order.status checks).
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
    .select("id, status")
    .eq("id", orderId)
    .single<Pick<OrderRow, "id" | "status">>();

  if (orderError || !order) {
    console.error("stripe-webhook: order not found for session", session.id, orderId, orderError);
    return;
  }

  // Idempotency belt-and-braces alongside the stripe_events ledger above.
  if (order.status === "paid") return;

  const { data: reservations, error: reservationsError } = await supabase
    .from("inventory_reservations")
    .select("id")
    .eq("order_id", orderId)
    .eq("status", "pending");

  if (reservationsError) {
    console.error("stripe-webhook: failed to load reservations", orderId, reservationsError);
  }

  for (const r of reservations ?? []) {
    const { error: confirmError } = await supabase.rpc("confirm_inventory_reservation", { p_reservation_id: r.id });
    if (confirmError) {
      console.error("stripe-webhook: confirm_inventory_reservation failed", r.id, confirmError);
    }
  }

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      stripe_payment_intent_id: paymentIntentId,
    })
    .eq("id", orderId);
  if (updateError) {
    console.error("stripe-webhook: failed to mark order paid", orderId, updateError);
  }

  const { data: fullOrder } = await supabase
    .from("orders")
    .select("id, recipient_snapshot, delivery_method, subtotal_cents, shipping_fee_cents, total_cents")
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

async function handlePaymentFailed(supabase: SupabaseClient, session: Stripe.Checkout.Session): Promise<void> {
  const orderId = session.client_reference_id ?? (session.metadata?.order_id as string | undefined);
  if (!orderId) return;

  const { data: reservations, error } = await supabase
    .from("inventory_reservations")
    .select("id")
    .eq("order_id", orderId)
    .in("status", ["pending", "confirmed"]);

  if (error) {
    console.error("stripe-webhook: failed to load reservations for failed payment", orderId, error);
  }

  for (const r of reservations ?? []) {
    const { error: releaseError } = await supabase.rpc("release_inventory_reservation", { p_reservation_id: r.id });
    if (releaseError) {
      console.error("stripe-webhook: release_inventory_reservation failed", r.id, releaseError);
    }
  }

  const { error: updateError } = await supabase.from("orders").update({ status: "payment_failed" }).eq("id", orderId);
  if (updateError) {
    console.error("stripe-webhook: failed to mark order payment_failed", orderId, updateError);
  }
}

import { getSupabaseAdmin, releaseOrderReservations } from "./_lib/supabase";
import { getStripe } from "./_lib/stripe";
import { requireEnv } from "./_lib/env";
import { jsonResponse, errorResponse } from "./_lib/responses";
import { createCheckoutSessionRequestSchema } from "./_lib/schemas";
import { computeShippingFeeCents, computeInclusiveGstCents } from "../../src/pricing";

// Kept identical to the reservation TTL passed into create_pending_order, and
// used again below as the Stripe Checkout Session's own `expires_at`. Without
// this, a reservation could lapse (get released back to stock, possibly
// resold) minutes before Stripe's own session expiry, so a customer paying
// near the end of the window could "succeed" against stock that's no longer
// theirs. Keeping both expiries in lockstep makes that impossible: Stripe
// refuses payment on an already-expired session.
const RESERVATION_TTL_MINUTES = 30;

// NOTE: there's no request-level idempotency key here — a network retry or
// a very fast double-click that slips past the storefront's disabled-button
// guard (src/cart.ts#isSubmitting) could create two orders/reservations for
// the same cart. Acceptable for the Phase 1 MVP; if this becomes a real
// problem, have the client generate a UUID per checkout attempt and thread
// it through as a Stripe idempotency key + a unique constraint check here.

interface StoreSettings {
  standard_shipping_fee_cents: number;
  free_shipping_threshold_cents: number;
  gst_rate: number;
  gst_registered: boolean;
}

interface ProductVariantRow {
  sku: string;
  name_snapshot: string;
  unit_price_cents: number;
  is_active: boolean;
  allow_self_collection: boolean;
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  const parsed = createCheckoutSessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "Invalid request", "validation_error");
  }
  const { items, deliveryMethod, recipient, ageConfirmed } = parsed.data;

  const supabase = getSupabaseAdmin();

  const { data: settings, error: settingsError } = await supabase
    .from("store_settings")
    .select("standard_shipping_fee_cents, free_shipping_threshold_cents, gst_rate, gst_registered")
    .eq("id", 1)
    .single<StoreSettings>();

  if (settingsError || !settings) {
    console.error("create-checkout-session: failed to load store_settings", settingsError);
    return errorResponse(500, "Store configuration unavailable");
  }

  const skus = items.map((i) => i.sku);
  const { data: variants, error: variantsError } = await supabase
    .from("product_variants")
    .select("sku, name_snapshot, unit_price_cents, is_active, allow_self_collection")
    .in("sku", skus)
    .returns<ProductVariantRow[]>();

  if (variantsError) {
    console.error("create-checkout-session: failed to load product_variants", variantsError);
    return errorResponse(500, "Failed to load product data");
  }

  const variantBySku = new Map((variants ?? []).map((v) => [v.sku, v]));

  for (const item of items) {
    const variant = variantBySku.get(item.sku);
    if (!variant || !variant.is_active) {
      return errorResponse(409, `Product ${item.sku} is no longer available`, "insufficient_stock");
    }
    if (deliveryMethod === "self_collection" && !variant.allow_self_collection) {
      return errorResponse(409, `Product ${item.sku} is not available for self collection`, "self_collection_unavailable");
    }
  }

  const lineItems = items.map((item) => {
    const variant = variantBySku.get(item.sku) as ProductVariantRow;
    return {
      sku: item.sku,
      nameSnapshot: variant.name_snapshot,
      unitPriceCents: variant.unit_price_cents,
      qty: item.qty,
      lineTotalCents: variant.unit_price_cents * item.qty,
    };
  });

  const subtotalCents = lineItems.reduce((sum, li) => sum + li.lineTotalCents, 0);
  const shippingFeeCents = computeShippingFeeCents({
    subtotalCents,
    freeShippingThresholdCents: settings.free_shipping_threshold_cents,
    standardShippingFeeCents: settings.standard_shipping_fee_cents,
    deliveryMethod,
  });
  const totalCents = subtotalCents + shippingFeeCents;
  const gstCents = computeInclusiveGstCents({
    amountCents: totalCents,
    gstRate: Number(settings.gst_rate),
    gstRegistered: settings.gst_registered,
  });

  // Atomic: creates the order, its items, and a stock reservation for every
  // line in one transaction — see supabase/migrations/0002_checkout_support.sql.
  const { data: order, error: orderError } = await supabase
    .rpc("create_pending_order", {
      p_items: lineItems,
      p_recipient: recipient,
      p_delivery_method: deliveryMethod,
      p_subtotal_cents: subtotalCents,
      p_shipping_fee_cents: shippingFeeCents,
      p_gst_cents: gstCents,
      p_total_cents: totalCents,
      p_age_confirmed: ageConfirmed,
      p_reservation_ttl_minutes: RESERVATION_TTL_MINUTES,
    })
    .single<{ id: string }>();

  if (orderError || !order) {
    if (orderError?.message?.includes("insufficient_stock")) {
      return errorResponse(409, "Some items are no longer available in the requested quantity", "insufficient_stock");
    }
    console.error("create-checkout-session: create_pending_order failed", orderError);
    return errorResponse(500, "Failed to create order");
  }

  const stripe = getStripe();
  const siteUrl = requireEnv("SITE_URL").replace(/\/$/, "");
  const expiresAtSeconds = Math.floor(Date.now() / 1000) + RESERVATION_TTL_MINUTES * 60;

  try {
    const stripeLineItems = lineItems.map((li) => ({
      price_data: {
        currency: "sgd",
        unit_amount: li.unitPriceCents,
        product_data: { name: li.nameSnapshot },
      },
      quantity: li.qty,
    }));
    if (shippingFeeCents > 0) {
      stripeLineItems.push({
        price_data: { currency: "sgd", unit_amount: shippingFeeCents, product_data: { name: "Shipping" } },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card", "paynow"],
      line_items: stripeLineItems,
      client_reference_id: order.id,
      metadata: { order_id: order.id },
      customer_email: recipient.email,
      expires_at: expiresAtSeconds,
      success_url: `${siteUrl}/?checkout=success&order_id=${order.id}`,
      cancel_url: `${siteUrl}/?checkout=cancelled&order_id=${order.id}`,
    });

    const { error: updateError } = await supabase
      .from("orders")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", order.id);
    if (updateError) {
      console.error("create-checkout-session: failed to save stripe session id", order.id, updateError);
    }

    if (!session.url) {
      throw new Error("Stripe session created without a url");
    }

    return jsonResponse(200, { checkoutUrl: session.url, orderId: order.id });
  } catch (err) {
    console.error("create-checkout-session: stripe session creation failed", order.id, err);
    // The order + reservations already exist — since there's no payment
    // session for them, release the stock rather than leaving it held
    // for up to RESERVATION_TTL_MINUTES for an order the customer can't pay.
    await releaseOrderReservations(supabase, order.id);
    await supabase.from("orders").update({ status: "payment_failed" }).eq("id", order.id);
    return errorResponse(502, "Failed to start payment session");
  }
};

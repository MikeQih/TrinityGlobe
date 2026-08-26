import { createHash, createHmac } from "node:crypto";
import type { Context } from "@netlify/functions";
import { getSupabaseAdmin, getUserIdFromRequest, releaseOrderReservations } from "./_lib/supabase";
import { getStripe } from "./_lib/stripe";
import { requireEnv } from "./_lib/env";
import { jsonResponse, errorResponse } from "./_lib/responses";
import { createCheckoutSessionRequestSchema } from "./_lib/schemas";
import { computeShippingFeeCents, computeInclusiveGstCents, effectiveUnitPriceCents } from "../../src/pricing";
import { SELF_COLLECTION_ENABLED } from "../../src/feature-flags";

// Kept identical to the reservation TTL passed into create_pending_order, and
// used again below as the Stripe Checkout Session's own `expires_at`. Without
// this, a reservation could lapse (get released back to stock, possibly
// resold) minutes before Stripe's own session expiry, so a customer paying
// near the end of the window could "succeed" against stock that's no longer
// theirs. Keeping both expiries in lockstep makes that impossible: Stripe
// refuses payment on an already-expired session. release-expired-
// reservations.ts additionally force-expires the Stripe session itself once
// a reservation actually lapses, closing the tiny remaining gap between the
// two timestamps being computed a few hundred ms apart.
const RESERVATION_TTL_MINUTES = 30;

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
  case_size: number | null;
  case_price_cents: number | null;
  five_case_size: number | null;
  five_case_price_cents: number | null;
  is_active: boolean;
  allow_self_collection: boolean;
}

interface LineItem {
  sku: string;
  nameSnapshot: string;
  unitPriceCents: number;
  qty: number;
  lineTotalCents: number;
}

type CheckoutResponseBody =
  | { mode: "hosted"; checkoutUrl: string; orderId: string }
  | { mode: "elements"; clientSecret: string; orderId: string };

// Identifies "this exact cart" so a reused checkoutAttemptId can be refused
// if the cart changed since the id was minted (e.g. the customer went back
// and edited quantities) instead of silently handing back a session for the
// old contents. Deliberately built from the same server-computed values
// that end up on the order — never trusts anything the client alone could
// have changed without it showing up here too.
function computeFingerprint(input: {
  lineItems: LineItem[];
  deliveryMethod: string;
  email: string;
  address: string;
  postalCode: string;
  totalCents: number;
}): string {
  const stable = JSON.stringify({
    items: [...input.lineItems]
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map((i) => ({ sku: i.sku, qty: i.qty, unitPriceCents: i.unitPriceCents })),
    deliveryMethod: input.deliveryMethod,
    email: input.email,
    address: input.address,
    postalCode: input.postalCode,
    totalCents: input.totalCents,
  });
  return createHash("sha256").update(stable).digest("hex");
}

// HMAC, not a plain hash — an unsalted sha256(ip) is small enough (the
// entire IPv4 space) to brute-force back to the original address offline,
// which would defeat the point of not storing the raw IP in the first
// place. Soft-fails (returns null) rather than throwing if the secret isn't
// configured, so a missing env var degrades to "no IP-based rate limiting"
// instead of taking checkout down entirely — same reasoning as the other
// optional-hardening envs in this codebase (VITE_STRIPE_PUBLISHABLE_KEY, etc).
function hashIp(ip: string): string | null {
  const secret = process.env.RATE_LIMIT_HMAC_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(ip).digest("hex");
}

async function buildStripeSessionParams(
  uiMode: "elements" | "hosted",
  orderId: string,
  lineItems: LineItem[],
  shippingFeeCents: number,
  recipientEmail: string,
  siteUrl: string,
  expiresAtSeconds: number
) {
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

  return uiMode === "elements"
    ? {
        mode: "payment" as const,
        ui_mode: "elements" as const,
        payment_method_types: ["card", "paynow"],
        line_items: stripeLineItems,
        metadata: { order_id: orderId },
        customer_email: recipientEmail,
        expires_at: expiresAtSeconds,
        // {CHECKOUT_SESSION_ID} is a literal template Stripe substitutes
        // itself — order_id is included too so the return page doesn't
        // depend on that substitution to know which order this was.
        return_url: `${siteUrl}/?checkout=return&order_id=${orderId}&session_id={CHECKOUT_SESSION_ID}`,
      }
    : {
        mode: "payment" as const,
        payment_method_types: ["card", "paynow"],
        line_items: stripeLineItems,
        client_reference_id: orderId,
        metadata: { order_id: orderId },
        customer_email: recipientEmail,
        expires_at: expiresAtSeconds,
        success_url: `${siteUrl}/?checkout=success&order_id=${orderId}`,
        cancel_url: `${siteUrl}/?checkout=cancelled&order_id=${orderId}`,
      };
}

function sessionToResponseBody(
  session: { ui_mode?: string | null; client_secret?: string | null; url?: string | null },
  orderId: string
): CheckoutResponseBody | null {
  if (session.ui_mode === "elements") {
    return session.client_secret ? { mode: "elements", clientSecret: session.client_secret, orderId } : null;
  }
  return session.url ? { mode: "hosted", checkoutUrl: session.url, orderId } : null;
}

export default async (req: Request, context: Context): Promise<Response> => {
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
  const { items, deliveryMethod, recipient, ageConfirmed, checkoutAttemptId } = parsed.data;

  if (deliveryMethod === "self_collection" && !SELF_COLLECTION_ENABLED) {
    return errorResponse(409, "Self collection is not currently available", "self_collection_unavailable");
  }

  const userId = await getUserIdFromRequest(req);
  const supabase = getSupabaseAdmin();
  const stripe = getStripe();

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
    .select(
      "sku, name_snapshot, unit_price_cents, case_size, case_price_cents, five_case_size, five_case_price_cents, is_active, allow_self_collection"
    )
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

  // Tiered per-bottle pricing: buying enough of one SKU to fill a case (or
  // five) earns that tier's price on the whole line. Uses the same function
  // src/cart.ts uses for its estimate, so what the drawer showed and what
  // gets charged here can't drift apart.
  const lineItems: LineItem[] = items.map((item) => {
    const variant = variantBySku.get(item.sku) as ProductVariantRow;
    const unitPriceCents = effectiveUnitPriceCents(item.qty, {
      bottlePriceCents: variant.unit_price_cents,
      caseSize: variant.case_size,
      casePriceCents: variant.case_price_cents,
      fiveCaseSize: variant.five_case_size,
      fiveCasePriceCents: variant.five_case_price_cents,
    });
    return {
      sku: item.sku,
      nameSnapshot: variant.name_snapshot,
      unitPriceCents,
      qty: item.qty,
      lineTotalCents: unitPriceCents * item.qty,
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

  const fingerprint = computeFingerprint({
    lineItems,
    deliveryMethod,
    email: recipient.email,
    address: recipient.address,
    postalCode: recipient.postalCode,
    totalCents,
  });

  const siteUrl = requireEnv("SITE_URL").replace(/\/$/, "");
  const expiresAtSeconds = Math.floor(Date.now() / 1000) + RESERVATION_TTL_MINUTES * 60;
  const uiMode = process.env.CHECKOUT_UI_MODE === "elements" ? "elements" : "hosted";

  // Idempotency: a double-click, a slow-network retry, or "back" then
  // resubmit from the payment stage (see src/cart.ts) all resend the same
  // checkoutAttemptId. checkout_attempt_id has a unique index (see
  // 0007_checkout_idempotency.sql), so this also covers a genuine race
  // between two near-simultaneous requests for the same id.
  if (checkoutAttemptId) {
    const { data: existing, error: existingError } = await supabase
      .from("orders")
      .select("id, status, stripe_checkout_session_id, checkout_fingerprint")
      .eq("checkout_attempt_id", checkoutAttemptId)
      .maybeSingle<{ id: string; status: string; stripe_checkout_session_id: string | null; checkout_fingerprint: string | null }>();

    if (existingError) {
      console.error("create-checkout-session: failed to check checkout_attempt_id", checkoutAttemptId, existingError);
      return errorResponse(500, "Failed to process checkout attempt");
    }

    if (existing) {
      if (existing.status !== "pending_payment") {
        // This exact attempt already concluded (paid/failed/expired/
        // cancelled/under review). The client should mint a fresh
        // checkoutAttemptId and resubmit, not retry this one forever.
        return errorResponse(409, "This checkout attempt has already been used", "checkout_attempt_conflict");
      }

      if (existing.checkout_fingerprint !== fingerprint) {
        // Same attempt id, different cart — most likely the customer went
        // back and changed something. Reusing the old session would charge
        // for a cart that no longer matches what's on screen, so this is
        // refused rather than silently resolved either way.
        return errorResponse(409, "Cart contents changed since this checkout attempt started", "checkout_attempt_conflict");
      }

      if (!existing.stripe_checkout_session_id) {
        // The order/reservation were created on a previous attempt, but the
        // process died before the Stripe session got created or saved.
        // Resume from here rather than erroring — reuses the exact
        // already-reserved order, doesn't create a second one.
        try {
          const params = await buildStripeSessionParams(
            uiMode,
            existing.id,
            lineItems,
            shippingFeeCents,
            recipient.email,
            siteUrl,
            expiresAtSeconds
          );
          const session = await stripe.checkout.sessions.create(params, {
            idempotencyKey: `checkout-session-${checkoutAttemptId}`,
          });
          await supabase.from("orders").update({ stripe_checkout_session_id: session.id }).eq("id", existing.id);
          const responseBody = sessionToResponseBody(session, existing.id);
          if (responseBody) return jsonResponse(200, responseBody);
          console.error("create-checkout-session: resumed session missing expected field", session.id);
          return errorResponse(500, "Failed to resume checkout attempt");
        } catch (err) {
          console.error("create-checkout-session: failed to create session for resumed order", existing.id, err);
          return errorResponse(502, "Failed to resume checkout attempt");
        }
      }

      const retrieved = await stripe.checkout.sessions.retrieve(existing.stripe_checkout_session_id);
      if (retrieved.status !== "open") {
        return errorResponse(409, "This checkout attempt has already been used", "checkout_attempt_conflict");
      }
      const reused = sessionToResponseBody(retrieved, existing.id);
      if (reused) return jsonResponse(200, reused);
      console.error("create-checkout-session: reusable session missing expected field", retrieved.id);
      return errorResponse(500, "Failed to resume checkout attempt");
    }
  }

  // Rate limiting (per-email and per-IP-hash) happens inside this RPC, under
  // advisory locks, so it can't be raced by concurrent requests the way a
  // separate "count, then insert" pair of queries could be. See
  // 0008_checkout_hardening.sql.
  const clientIp = context.ip;
  const ipHash = clientIp ? hashIp(clientIp) : null;

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
      p_user_id: userId,
      p_checkout_attempt_id: checkoutAttemptId ?? null,
      p_ip_hash: ipHash,
      p_checkout_fingerprint: fingerprint,
    })
    .single<{ id: string }>();

  if (orderError || !order) {
    if (orderError?.message?.includes("insufficient_stock")) {
      return errorResponse(409, "Some items are no longer available in the requested quantity", "insufficient_stock");
    }
    if (orderError?.message?.includes("rate_limited_email") || orderError?.message?.includes("rate_limited_ip")) {
      return errorResponse(429, "Too many checkout attempts — please complete or wait for one to expire", "rate_limited");
    }
    if (orderError?.message?.includes("checkout_attempt_id")) {
      // Unique-index violation: two near-simultaneous requests for the same
      // attempt raced each other. The loser just asks the client to retry,
      // which will find the winner's order via the idempotency check above.
      return errorResponse(409, "This checkout attempt is already being processed", "checkout_attempt_conflict");
    }
    console.error("create-checkout-session: create_pending_order failed", orderError);
    return errorResponse(500, "Failed to create order");
  }

  try {
    const params = await buildStripeSessionParams(uiMode, order.id, lineItems, shippingFeeCents, recipient.email, siteUrl, expiresAtSeconds);
    const session = await stripe.checkout.sessions.create(
      params,
      checkoutAttemptId ? { idempotencyKey: `checkout-session-${checkoutAttemptId}` } : undefined
    );

    const { error: updateError } = await supabase
      .from("orders")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", order.id);
    if (updateError) {
      console.error("create-checkout-session: failed to save stripe session id", order.id, updateError);
    }

    const responseBody = sessionToResponseBody(session, order.id);
    if (responseBody) return jsonResponse(200, responseBody);
    throw new Error(`Stripe session created without expected field for ui_mode=${uiMode}`);
  } catch (err) {
    console.error("create-checkout-session: stripe session creation failed", order.id, err);
    // The order + reservations already exist — since there's no payment
    // session for them, release the stock rather than leaving it held
    // for up to RESERVATION_TTL_MINUTES for an order the customer can't pay.
    await releaseOrderReservations(supabase, order.id);
    await supabase.from("orders").update({ status: "payment_failed" }).eq("id", order.id).eq("status", "pending_payment");
    return errorResponse(502, "Failed to start payment session");
  }
};

// Pure pricing math, shared by the client-side cart drawer (an *estimate*
// for display) and netlify/functions/create-checkout-session.ts (the
// authoritative calculation, called with live values from the
// `store_settings` table). Keeping this in one place means the number the
// customer sees in the drawer can't silently drift from what they're
// actually charged.

export interface PriceTiers {
  bottlePriceCents: number;
  caseSize?: number | null;
  casePriceCents?: number | null;
  fiveCaseSize?: number | null;
  fiveCasePriceCents?: number | null;
}

/**
 * A line's per-bottle price depends on how many bottles of that SKU are in
 * it — buying enough to fill a case (or five) earns that tier's price on
 * the *whole* line, not just the bottles bought past the threshold. This is
 * the single source of truth for that rule: the cart drawer estimate
 * (src/cart.ts) and the authoritative recompute
 * (netlify/functions/create-checkout-session.ts) both call it, so a
 * customer is never quoted one price and charged another.
 */
export function effectiveUnitPriceCents(qty: number, tiers: PriceTiers): number {
  if (tiers.fiveCaseSize && tiers.fiveCasePriceCents != null && qty >= tiers.fiveCaseSize) {
    return tiers.fiveCasePriceCents;
  }
  if (tiers.caseSize && tiers.casePriceCents != null && qty >= tiers.caseSize) {
    return tiers.casePriceCents;
  }
  return tiers.bottlePriceCents;
}

export interface ShippingInput {
  subtotalCents: number;
  freeShippingThresholdCents: number;
  standardShippingFeeCents: number;
  deliveryMethod: "standard" | "self_collection";
}

export function computeShippingFeeCents(input: ShippingInput): number {
  if (input.deliveryMethod === "self_collection") return 0;
  if (input.subtotalCents >= input.freeShippingThresholdCents) return 0;
  return input.standardShippingFeeCents;
}

export function computeRemainingForFreeShippingCents(
  subtotalCents: number,
  freeShippingThresholdCents: number
): number {
  return Math.max(0, freeShippingThresholdCents - subtotalCents);
}

export interface GstInput {
  amountCents: number;
  gstRate: number;
  /** Whether the business is GST-registered yet — see PRD §10.1/§16.2, pending finance confirmation. */
  gstRegistered: boolean;
}

/**
 * GST is priced inclusively per PRD §10.2 ("面向公众展示的价格应为 GST-inclusive") —
 * this extracts the GST *component* already baked into `amountCents` for
 * order-record purposes, it does not add anything on top.
 */
export function computeInclusiveGstCents(input: GstInput): number {
  if (!input.gstRegistered) return 0;
  return Math.round(input.amountCents - input.amountCents / (1 + input.gstRate));
}

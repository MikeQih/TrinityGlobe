// Pure pricing math, shared by the client-side cart drawer (an *estimate*
// for display) and netlify/functions/create-checkout-session.ts (the
// authoritative calculation, called with live values from the
// `store_settings` table). Keeping this in one place means the number the
// customer sees in the drawer can't silently drift from what they're
// actually charged.

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

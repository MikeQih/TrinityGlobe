import { describe, it, expect } from "vitest";
import {
  computeShippingFeeCents,
  computeRemainingForFreeShippingCents,
  computeInclusiveGstCents,
  effectiveUnitPriceCents,
} from "../src/pricing";

describe("computeShippingFeeCents", () => {
  const base = {
    freeShippingThresholdCents: 12000,
    standardShippingFeeCents: 1500,
  };

  it("charges the standard fee below the free-shipping threshold", () => {
    expect(
      computeShippingFeeCents({ ...base, subtotalCents: 5000, deliveryMethod: "standard" })
    ).toBe(1500);
  });

  it("is free once the subtotal reaches the threshold", () => {
    expect(
      computeShippingFeeCents({ ...base, subtotalCents: 12000, deliveryMethod: "standard" })
    ).toBe(0);
  });

  it("is free above the threshold too", () => {
    expect(
      computeShippingFeeCents({ ...base, subtotalCents: 26000, deliveryMethod: "standard" })
    ).toBe(0);
  });

  it("is always free for self collection, even below the threshold", () => {
    expect(
      computeShippingFeeCents({ ...base, subtotalCents: 100, deliveryMethod: "self_collection" })
    ).toBe(0);
  });

  it("is free exactly one cent below the threshold minus one cent (boundary just under)", () => {
    expect(
      computeShippingFeeCents({ ...base, subtotalCents: 11999, deliveryMethod: "standard" })
    ).toBe(1500);
  });
});

describe("computeRemainingForFreeShippingCents", () => {
  it("returns the gap to the threshold", () => {
    expect(computeRemainingForFreeShippingCents(8000, 12000)).toBe(4000);
  });

  it("floors at zero once the threshold is met", () => {
    expect(computeRemainingForFreeShippingCents(12000, 12000)).toBe(0);
    expect(computeRemainingForFreeShippingCents(20000, 12000)).toBe(0);
  });
});

describe("computeInclusiveGstCents", () => {
  it("returns zero when the business isn't GST-registered yet", () => {
    expect(computeInclusiveGstCents({ amountCents: 10900, gstRate: 0.09, gstRegistered: false })).toBe(0);
  });

  it("extracts the GST component already included in a GST-inclusive price", () => {
    // S$109.00 inclusive of 9% GST = S$100.00 (net) + S$9.00 (GST)
    expect(computeInclusiveGstCents({ amountCents: 10900, gstRate: 0.09, gstRegistered: true })).toBe(900);
  });

  it("rounds to the nearest cent rather than accumulating fractional drift", () => {
    // 260.00 inclusive of 9% -> net 238.5321... -> GST component 21.4678...
    const gst = computeInclusiveGstCents({ amountCents: 26000, gstRate: 0.09, gstRegistered: true });
    expect(Number.isInteger(gst)).toBe(true);
    expect(gst).toBe(2147);
  });

  it("is zero for a zero amount", () => {
    expect(computeInclusiveGstCents({ amountCents: 0, gstRate: 0.09, gstRegistered: true })).toBe(0);
  });
});

describe("effectiveUnitPriceCents", () => {
  const tiers = {
    bottlePriceCents: 8500,
    caseSize: 6,
    casePriceCents: 8000,
    fiveCaseSize: 30,
    fiveCasePriceCents: 7500,
  };

  it("charges bottle price below the case threshold", () => {
    expect(effectiveUnitPriceCents(1, tiers)).toBe(8500);
    expect(effectiveUnitPriceCents(5, tiers)).toBe(8500);
  });

  it("charges case price once qty reaches the case size", () => {
    expect(effectiveUnitPriceCents(6, tiers)).toBe(8000);
    expect(effectiveUnitPriceCents(29, tiers)).toBe(8000);
  });

  it("charges five-case price once qty reaches the five-case size", () => {
    expect(effectiveUnitPriceCents(30, tiers)).toBe(7500);
    expect(effectiveUnitPriceCents(100, tiers)).toBe(7500);
  });

  it("falls back to bottle price when a tier's size is unknown, even if a price exists", () => {
    const partial = { bottlePriceCents: 8500, casePriceCents: 8000 }; // no caseSize
    expect(effectiveUnitPriceCents(12, partial)).toBe(8500);
  });

  it("falls back to bottle price when a tier's price is unknown, even if a size exists", () => {
    const partial = { bottlePriceCents: 8500, caseSize: 6 }; // no casePriceCents
    expect(effectiveUnitPriceCents(12, partial)).toBe(8500);
  });
});

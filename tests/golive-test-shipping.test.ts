import { describe, it, expect } from "vitest";
import { isGoLiveTestShippingExempt, type GoLiveTestShippingInput } from "../netlify/functions/_lib/golive-test-shipping";

const TEST_SKU = "GOLIVE-HIDDEN-TEST-SKU";
const TEST_EMAIL = "delivered@resend.dev";

function baseInput(overrides: Partial<GoLiveTestShippingInput> = {}): GoLiveTestShippingInput {
  return {
    items: [{ sku: TEST_SKU, qty: 1 }],
    deliveryMethod: "standard",
    recipientEmail: TEST_EMAIL,
    subtotalCents: 50,
    variant: { isActive: true, unitPriceCents: 50 },
    testSku: TEST_SKU,
    testEmail: TEST_EMAIL,
    ...overrides,
  };
}

describe("isGoLiveTestShippingExempt", () => {
  it("the fully matching cart is exempt", () => {
    expect(isGoLiveTestShippingExempt(baseInput())).toBe(true);
  });

  it("1. neither env var set -> not exempt", () => {
    expect(isGoLiveTestShippingExempt(baseInput({ testSku: undefined, testEmail: undefined }))).toBe(false);
  });

  it("2. only GOLIVE_TEST_SKU set -> not exempt", () => {
    expect(isGoLiveTestShippingExempt(baseInput({ testEmail: undefined }))).toBe(false);
  });

  it("2. only GOLIVE_TEST_EMAIL set -> not exempt", () => {
    expect(isGoLiveTestShippingExempt(baseInput({ testSku: undefined }))).toBe(false);
  });

  it("3. wrong SKU -> not exempt", () => {
    expect(isGoLiveTestShippingExempt(baseInput({ items: [{ sku: "SOME-OTHER-SKU", qty: 1 }] }))).toBe(false);
  });

  it("4. correct SKU mixed with another item -> not exempt", () => {
    expect(
      isGoLiveTestShippingExempt(
        baseInput({ items: [{ sku: TEST_SKU, qty: 1 }, { sku: "REAL-SKU", qty: 1 }], subtotalCents: 650 })
      )
    ).toBe(false);
  });

  it("5. qty greater than 1 -> not exempt", () => {
    expect(isGoLiveTestShippingExempt(baseInput({ items: [{ sku: TEST_SKU, qty: 2 }], subtotalCents: 100 }))).toBe(
      false
    );
  });

  it("5. qty of 0 is never a real cart item, but is still rejected defensively", () => {
    expect(isGoLiveTestShippingExempt(baseInput({ items: [{ sku: TEST_SKU, qty: 0 }], subtotalCents: 0 }))).toBe(
      false
    );
  });

  it("6. wrong recipient email -> not exempt", () => {
    expect(isGoLiveTestShippingExempt(baseInput({ recipientEmail: "someone-else@example.com" }))).toBe(false);
  });

  it("6. recipient email is compared case-insensitively and trimmed", () => {
    expect(isGoLiveTestShippingExempt(baseInput({ recipientEmail: "  DELIVERED@Resend.Dev  " }))).toBe(true);
  });

  it("7. DB unit price is not exactly 50 cents -> not exempt", () => {
    expect(isGoLiveTestShippingExempt(baseInput({ variant: { isActive: true, unitPriceCents: 51 } }))).toBe(false);
  });

  it("7. DB unit price of 49 cents -> not exempt (must be exact, not <=)", () => {
    expect(isGoLiveTestShippingExempt(baseInput({ variant: { isActive: true, unitPriceCents: 49 } }))).toBe(false);
  });

  it("8. inactive variant -> not exempt", () => {
    expect(isGoLiveTestShippingExempt(baseInput({ variant: { isActive: false, unitPriceCents: 50 } }))).toBe(false);
  });

  it("variant missing entirely (SKU not found in product_variants) -> not exempt", () => {
    expect(isGoLiveTestShippingExempt(baseInput({ variant: undefined }))).toBe(false);
  });

  it("self_collection delivery method -> not exempt (standard delivery required)", () => {
    expect(isGoLiveTestShippingExempt(baseInput({ deliveryMethod: "self_collection" }))).toBe(false);
  });

  it("subtotal not exactly 50 cents -> not exempt, even if every other condition matches", () => {
    expect(isGoLiveTestShippingExempt(baseInput({ subtotalCents: 51 }))).toBe(false);
  });

  it("real production SKU never accidentally matches an unset test SKU", () => {
    expect(
      isGoLiveTestShippingExempt(
        baseInput({
          items: [{ sku: "COGNAC-HENNESSY-VSOP", qty: 1 }],
          variant: { isActive: true, unitPriceCents: 8500 },
          subtotalCents: 8500,
          testSku: undefined,
          testEmail: undefined,
        })
      )
    ).toBe(false);
  });
});

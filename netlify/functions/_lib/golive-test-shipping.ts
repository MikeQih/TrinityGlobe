// TEMPORARY GO-LIVE VERIFICATION MECHANISM — see PROJECT_STATUS.md.
//
// One-off, tightly-scoped shipping-fee exemption that exists solely to let a
// single real S$0.50 Stripe Checkout be completed end-to-end (Payment Intent,
// PayNow, webhook, refund) without waiving the real S$15 flat shipping fee /
// S$120 free-shipping threshold for anyone else. It is dormant unless BOTH
// GOLIVE_TEST_SKU and GOLIVE_TEST_EMAIL are configured — with either unset
// (the case in every environment except a deliberately-configured go-live
// test), isGoLiveTestShippingExempt always returns false and every order is
// charged the normal shipping fee computed by src/pricing.ts's
// computeShippingFeeCents, unchanged.
//
// Every condition below is required simultaneously; failing any one of them
// falls through to the normal shipping rule rather than erroring, so a
// half-matched cart is never accidentally waived and checkout never breaks
// because of a misconfigured test env var.
//
// Must be deleted in a follow-up PR once the real go-live payment test this
// exists for has been completed — see PROJECT_STATUS.md.

const REQUIRED_UNIT_PRICE_CENTS = 50;
const REQUIRED_SUBTOTAL_CENTS = 50;
const REQUIRED_QTY = 1;

export interface GoLiveTestCartItem {
  sku: string;
  qty: number;
}

export interface GoLiveTestVariant {
  isActive: boolean;
  /** The variant's raw `unit_price_cents` column — never the tiered/effective price. */
  unitPriceCents: number;
}

export interface GoLiveTestShippingInput {
  items: GoLiveTestCartItem[];
  deliveryMethod: string;
  recipientEmail: string;
  subtotalCents: number;
  /**
   * The live DB row for the cart's one item, if `items` has exactly one item
   * and its SKU was found in `product_variants`. Undefined otherwise — the
   * caller must never fabricate this from unverified/client-supplied data.
   */
  variant: GoLiveTestVariant | undefined;
  /** `process.env.GOLIVE_TEST_SKU` at call time. */
  testSku: string | undefined;
  /** `process.env.GOLIVE_TEST_EMAIL` at call time. */
  testEmail: string | undefined;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isGoLiveTestShippingExempt(input: GoLiveTestShippingInput): boolean {
  if (!input.testSku || !input.testEmail) return false;
  if (input.items.length !== 1) return false;

  const item = input.items[0];
  if (!item) return false;
  if (item.sku !== input.testSku) return false;
  if (item.qty !== REQUIRED_QTY) return false;

  if (!input.variant || !input.variant.isActive) return false;
  if (input.variant.unitPriceCents !== REQUIRED_UNIT_PRICE_CENTS) return false;

  if (normalizeEmail(input.recipientEmail) !== normalizeEmail(input.testEmail)) return false;

  if (input.deliveryMethod !== "standard") return false;
  if (input.subtotalCents !== REQUIRED_SUBTOTAL_CENTS) return false;

  return true;
}

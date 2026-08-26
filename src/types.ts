export interface ProductPrices {
  bottle?: number | null;
  case?: number | null;
  fiveCases?: number | null;
  /** Bottles per case — a case/five-case price is only ever buyable once this is known. */
  caseSize?: number | null;
  /** Bottles per "5 cases" tier — usually, but not necessarily, 5x caseSize. */
  fiveCaseSize?: number | null;
}

// Shape of an entry in products.json / window.TG_PRODUCTS — editorial content
// owned by Netlify CMS. Only `sku` and `prices.bottle` are used to seed the
// cart optimistically; the server re-validates both at checkout time.
export interface ProductSummary {
  sku: string;
  name: string;
  nameEn?: string;
  nameZh?: string;
  image: string;
  prices?: ProductPrices;
}

/**
 * A cart line's price ladder in cents, snapshotted from ProductPrices when
 * the item is first added. Kept as tiers (not a single unitPriceCents)
 * because the applicable price depends on the line's *current* qty — see
 * src/pricing.ts#effectiveUnitPriceCents, which both the cart drawer and
 * create-checkout-session.ts call so they can never disagree.
 */
export interface CartItemPriceTiers {
  bottlePriceCents: number;
  caseSize?: number | null;
  casePriceCents?: number | null;
  fiveCaseSize?: number | null;
  fiveCasePriceCents?: number | null;
}

export interface CartItem {
  sku: string;
  name: string;
  image: string;
  priceTiers: CartItemPriceTiers;
  qty: number;
}

export interface LiveProductInfo {
  sku: string;
  unitPriceCents: number;
  availableStock: number;
  isActive: boolean;
}

export type DeliveryMethod = "standard" | "self_collection";

export type Gender = "male" | "female" | "prefer_not_to_say";

/** Fields collected on the email/password signup form, written to customer_profiles once the OTP is verified. */
export interface SignupProfile {
  firstName: string;
  lastName: string;
  gender: Gender;
  dateOfBirth: string; // yyyy-mm-dd, matches <input type="date">
  newsletterSubscribed: boolean;
}

export interface CheckoutRecipient {
  name: string;
  phone: string;
  email: string;
  address: string;
  postalCode: string;
  notes: string;
}

export interface CreateCheckoutSessionRequest {
  items: { sku: string; qty: number }[];
  deliveryMethod: DeliveryMethod;
  recipient: CheckoutRecipient;
  ageConfirmed: boolean;
  /** One UUID per checkout form visit, reused across retries — see src/cart.ts and create-checkout-session.ts's idempotency handling. */
  checkoutAttemptId?: string;
}

// The `mode` a given create-checkout-session call returns is decided
// server-side by CHECKOUT_UI_MODE (see that function) — the client just
// branches on whichever shape comes back, it never chooses this itself.
export type CreateCheckoutSessionResponse =
  | { mode: "hosted"; checkoutUrl: string; orderId: string }
  | { mode: "elements"; clientSecret: string; orderId: string };

/** Shape returned by GET /.netlify/functions/get-checkout-session-status — display-only (see src/cart.ts's return-page handling); order status/inventory/emails are still driven entirely by the Stripe webhook, never by this. */
export interface CheckoutSessionStatus {
  status: "open" | "complete" | "expired";
  paymentStatus: "paid" | "unpaid" | "no_payment_required";
  orderId: string | null;
}

export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "preparing"
  | "ready_for_collection"
  | "out_for_delivery"
  | "completed"
  | "cancelled"
  | "refunded"
  | "payment_failed"
  | "payment_review"
  | "expired";

export interface MyOrderItem {
  sku: string;
  name: string;
  qty: number;
  unitPriceCents: number;
}

/** A row from customer_addresses (see supabase/migrations/0006_customer_addresses.sql, 0009_address_unit_number.sql) — see addresses.html / src/addresses-page.ts. */
export interface CustomerAddress {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  address: string;
  postalCode: string;
  unitNumber: string | null;
  isDefault: boolean;
}

/** Shape returned by GET /.netlify/functions/get-my-orders — see orders.html / src/orders-page.ts. */
export interface MyOrder {
  id: string;
  status: OrderStatus;
  totalCents: number;
  subtotalCents: number;
  shippingFeeCents: number;
  /** The GST component already included in totalCents — 0 whenever the business wasn't GST-registered yet at checkout time (see gstRegisteredAtCheckout). Never shown as a line item unless gstRegisteredAtCheckout is true. */
  gstCents: number;
  /** Snapshotted at checkout — whether GST applied to this specific order, independent of the store's current registration status. See supabase/migrations/0017_gst_registration_effective_date.sql. */
  gstRegisteredAtCheckout: boolean;
  refundedCents: number;
  currency: string;
  deliveryMethod: DeliveryMethod;
  createdAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
  recipient: CheckoutRecipient;
  items: MyOrderItem[];
  /** Only set when status is 'pending_payment' — when the backing inventory reservation (and Stripe session) will lapse. Drives the "继续付款 before HH:MM" countdown; see src/orders-page.ts. */
  reservationExpiresAt: string | null;
  /** Whether this order has a Stripe Checkout Session attached yet — false only in the narrow "order row created, session id not yet saved" window, see create-checkout-session.ts's idempotency/resume handling. */
  hasCheckoutSession: boolean;
}

/** Response from POST /.netlify/functions/resume-checkout-session — reuses the same discriminated union as creating a fresh session, since the storefront mounts either shape the same way. */
export type ResumeCheckoutSessionResponse =
  | { mode: "hosted"; checkoutUrl: string; orderId: string }
  | { mode: "elements"; clientSecret: string; orderId: string };

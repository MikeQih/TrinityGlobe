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
}

export interface CreateCheckoutSessionResponse {
  checkoutUrl: string;
  orderId: string;
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
  | "payment_failed";

export interface MyOrderItem {
  name: string;
  qty: number;
  unitPriceCents: number;
}

/** Shape returned by GET /.netlify/functions/get-my-orders — see orders.html / src/orders-page.ts. */
export interface MyOrder {
  id: string;
  status: OrderStatus;
  totalCents: number;
  currency: string;
  deliveryMethod: DeliveryMethod;
  createdAt: string;
  items: MyOrderItem[];
}

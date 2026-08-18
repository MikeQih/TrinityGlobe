export interface ProductPrices {
  bottle?: number | null;
  case?: number | null;
  fiveCases?: number | null;
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

export interface CartItem {
  sku: string;
  name: string;
  image: string;
  /** Optimistic client-side price snapshot in cents, shown before checkout. */
  unitPriceCents: number;
  qty: number;
}

export interface LiveProductInfo {
  sku: string;
  unitPriceCents: number;
  availableStock: number;
  isActive: boolean;
}

export type DeliveryMethod = "standard" | "self_collection";

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

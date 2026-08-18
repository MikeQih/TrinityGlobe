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

export type AdminRole = "admin" | "ops" | "finance_readonly";

export interface RecipientSnapshot {
  name: string;
  phone: string;
  email: string;
  address: string;
  postalCode: string;
  notes: string;
}

export interface Order {
  id: string;
  status: OrderStatus;
  recipient_snapshot: RecipientSnapshot;
  delivery_method: "standard" | "self_collection";
  age_confirmed: boolean;
  subtotal_cents: number;
  shipping_fee_cents: number;
  gst_cents: number;
  total_cents: number;
  currency: string;
  refunded_cents: number;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  internal_notes: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: number;
  order_id: string;
  sku: string;
  name_snapshot: string;
  unit_price_cents: number;
  qty: number;
  line_total_cents: number;
}

export interface OrderStatusHistoryEntry {
  id: number;
  order_id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  changed_by: string;
  changed_at: string;
}

export const FULFILLABLE_STATUSES: OrderStatus[] = [
  "paid",
  "preparing",
  "ready_for_collection",
  "out_for_delivery",
  "completed",
];

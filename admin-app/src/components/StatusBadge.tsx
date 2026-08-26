import type { OrderStatus } from "../lib/types";

const LABELS: Record<OrderStatus, string> = {
  pending_payment: "Pending Payment",
  paid: "Paid",
  preparing: "Preparing",
  ready_for_collection: "Ready for Collection",
  out_for_delivery: "Out for Delivery",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
  payment_failed: "Payment Failed",
  payment_review: "Payment Review",
  expired: "Payment Expired",
};

// Groups statuses into a severity so the list is scannable at a glance —
// not the brand accent, a separate semantic channel (good/attention/bad/neutral).
const SEVERITY: Record<OrderStatus, "neutral" | "good" | "attention" | "bad"> = {
  pending_payment: "neutral",
  paid: "good",
  preparing: "attention",
  ready_for_collection: "attention",
  out_for_delivery: "attention",
  completed: "good",
  cancelled: "bad",
  refunded: "bad",
  payment_failed: "bad",
  // Needs a staff member to check Stripe/inventory manually before this can
  // resolve either way — flagged the same as an outright failure so it
  // doesn't get lost among ordinary "attention" fulfilment states.
  payment_review: "bad",
  expired: "bad",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`status-badge status-${SEVERITY[status]}`}>{LABELS[status]}</span>;
}

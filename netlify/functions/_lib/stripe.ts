import Stripe from "stripe";
import { requireEnv } from "./env";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;
  // No explicit apiVersion pin: Stripe uses the account's configured default
  // API version. Revisit if/when this project needs a specific pinned
  // version's behavior.
  client = new Stripe(requireEnv("STRIPE_SECRET_KEY"));
  return client;
}

/**
 * Human-readable failure reason for a Refund in a terminal-failure state,
 * shared between admin-refund-order.ts's synchronous path and
 * stripe-webhook.ts's async refund.updated/refund.failed handling so the
 * two never disagree about what "why did this fail" means for the same
 * Refund object. Returns null for anything not actually failed/canceled —
 * callers should only ever pass this to apply_refund_status alongside a
 * 'failed' or 'canceled' status.
 */
export function refundFailureReason(refund: Stripe.Refund): string | null {
  if (refund.status === "canceled") return refund.failure_reason ?? "Refund canceled";
  if (refund.status === "failed") return refund.failure_reason ?? "Refund failed";
  return null;
}

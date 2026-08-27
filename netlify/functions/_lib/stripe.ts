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

import { loadStripe, type Stripe } from "@stripe/stripe-js";

// Same null-safe pattern as ./supabase.ts: this ships inside storefront.js
// alongside guest checkout, so a missing/misconfigured key must never throw
// and take the whole cart down with it. Only reachable at all when the
// server opted into CHECKOUT_UI_MODE=elements — hosted checkout (the
// default) never calls this.
const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripeClient(): Promise<Stripe | null> {
  if (!publishableKey) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("VITE_STRIPE_PUBLISHABLE_KEY not set — Payment Element checkout can't be mounted.");
    }
    return Promise.resolve(null);
  }
  if (!stripePromise) stripePromise = loadStripe(publishableKey);
  return stripePromise;
}

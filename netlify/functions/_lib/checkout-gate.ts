import { errorResponse } from "./responses";

// Fail-closed on purpose: checkout is only ever enabled when this env var is
// the exact string "true". Unset, empty, "false", "1", "TRUE", or any other
// value all mean disabled — there is no "default enabled" branch. This
// exists because Production's Stripe key is a test key and its webhook
// secret is unset (see PROJECT_STATUS.md's pre-merge Go/No-Go audit): a
// customer completing hosted Checkout today would appear to pay but the
// order would never be marked paid, since the webhook signature check would
// 500 before ever reading the payload. Every entry point that can create or
// resume a Stripe payment session must call this before doing anything else.
export function isCheckoutEnabled(): boolean {
  return process.env.CHECKOUT_ENABLED === "true";
}

export function checkoutDisabledResponse(): Response {
  return errorResponse(503, "Online checkout is temporarily unavailable", "checkout_disabled");
}

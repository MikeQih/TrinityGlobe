// Shared between the storefront bundle (src/cart.ts) and Netlify Functions
// (netlify/functions/create-checkout-session.ts imports straight from src/,
// same pattern as its pricing.ts import) — one flag, so the UI and the
// server-side validation can never disagree about whether self-collection
// is currently offered.
//
// Self-collection is paused until the licensed premises / collection point
// question is settled (see PROJECT_STATUS.md) — the collection address
// previously shown was the founder's home, which isn't confirmed to be a
// location the liquor licence covers for handing over stock, and publishing
// a home address to any visitor who reaches checkout is its own separate
// problem. Flip back to true once a real collection point + licence terms
// are confirmed; nothing else needs to change.
export const SELF_COLLECTION_ENABLED = false;

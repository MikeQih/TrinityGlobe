// Browser-only UI mirror of the server-side CHECKOUT_ENABLED gate (see
// netlify/functions/_lib/checkout-gate.ts). This constant only controls
// what the cart drawer shows — it is NOT the security boundary. Even if a
// build somehow shipped with this true while the Netlify Function env var
// is unset, create-checkout-session.ts and resume-checkout-session.ts still
// fail closed on their own read of process.env.CHECKOUT_ENABLED. Kept in a
// standalone file (not src/feature-flags.ts) because feature-flags.ts is
// also imported directly by the Netlify Functions bundle, which is built by
// esbuild and does not go through Vite's import.meta.env replacement.
//
// Same fail-closed rule as the server: only the literal string "true"
// enables it.
export const CHECKOUT_ENABLED = import.meta.env.VITE_CHECKOUT_ENABLED === "true";

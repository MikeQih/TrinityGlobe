import { defineConfig, devices } from "@playwright/test";

// Deliberately does NOT define a `webServer` — the checkout e2e test needs
// `netlify dev` running with real Stripe/Supabase *test-mode* credentials
// (see tests/e2e/checkout.spec.ts), which isn't something `playwright test`
// can bootstrap on its own. Start `netlify dev` yourself, then run
// `npm run e2e` against it.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: process.env.SITE_URL ?? "http://localhost:8888",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Real Chrome Stable, headed — needed for tests/e2e/payment-element.spec.ts's
    // 3DS case specifically: the "actions.confirm() never resolves" bug this
    // suite guards against was only confirmed (twice) against real Chrome, not
    // bundled Chromium, so that regression test should keep running here too.
    // Run with `npx playwright test --project=chrome-real`.
    { name: "chrome-real", use: { ...devices["Desktop Chrome"], channel: "chrome", headless: false } },
    // WebKit (desktop Safari's engine) — scoped to the mobile cart/header
    // layout suite only, since it's the one spec in this repo that's purely
    // static (own inline HTTP server, localStorage-seeded cart, no
    // Netlify/Stripe/Supabase dependency) and therefore safe to run under an
    // engine the other e2e specs were never validated against. See that
    // file's header comment for what WebKit here can and can't prove about
    // real iOS Safari's dynamic-toolbar viewport behavior.
    { name: "webkit", use: { ...devices["Desktop Safari"] }, testMatch: /mobile-cart-safari\.spec\.ts/ },
  ],
});

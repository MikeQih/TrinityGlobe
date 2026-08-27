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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

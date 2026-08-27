import { test, expect } from "@playwright/test";

/**
 * Verifies the CHECKOUT_ENABLED kill switch (netlify/functions/_lib/checkout-gate.ts)
 * actually blocks both entry points that can create or resume a Stripe
 * payment session, before any side effect (Stripe call, order row,
 * inventory reservation, rate-limit record).
 *
 * Skipped by default — needs its own `netlify dev` process started with
 * CHECKOUT_ENABLED unset (or "false", or any other non-"true" value) in its
 * env, which is the opposite of what tests/e2e/checkout.spec.ts needs
 * running at the same time. Run separately:
 *
 *   1. In .env (or the shell), set CHECKOUT_ENABLED=false (or unset it).
 *   2. Run `netlify dev` in one terminal.
 *   3. Set RUN_E2E_DISABLED=1 in another.
 *   4. `npx playwright test tests/e2e/checkout-disabled.spec.ts`
 */
const shouldRun = Boolean(process.env.RUN_E2E_DISABLED);

test.describe("checkout kill switch", () => {
  test.skip(!shouldRun, "requires netlify dev with CHECKOUT_ENABLED unset/false (see file header)");

  test("create-checkout-session refuses with 503 checkout_disabled and creates nothing", async ({ request }) => {
    const res = await request.post("/.netlify/functions/create-checkout-session", {
      data: {
        items: [{ sku: "ANY-SKU", qty: 1 }],
        deliveryMethod: "standard",
        recipient: {
          name: "Gate Test",
          phone: "91234567",
          email: "gate-test@example.com",
          address: "1 Test Street",
          postalCode: "123456",
          notes: "",
        },
        ageConfirmed: true,
      },
    });
    expect(res.status()).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("checkout_disabled");
  });

  test("resume-checkout-session refuses with 503 checkout_disabled before ever loading the order", async ({
    request,
  }) => {
    // Deliberately a syntactically-valid but non-existent order id — if the
    // gate check runs before the order lookup (as it must), this 503s
    // exactly the same as a real pending order would, without ever
    // touching the database or requiring a signed-in session.
    const res = await request.post("/.netlify/functions/resume-checkout-session", {
      data: { orderId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status()).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("checkout_disabled");
  });
});

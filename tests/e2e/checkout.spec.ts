import { test, expect } from "@playwright/test";

/**
 * End-to-end cart -> checkout -> Stripe test-mode payment -> order Paid flow.
 *
 * Skipped by default: it needs `netlify dev` running against a real
 * Supabase project (with at least one active, in-stock product_variant
 * whose sku matches a products.json entry) and Stripe *test-mode* keys —
 * none of which exist until the business sets those accounts up (see the
 * PRD's "卡在账号密钥上的部分" section). Once they do:
 *
 *   1. Run `netlify dev` in one terminal.
 *   2. Set RUN_E2E=1 and E2E_TEST_SKU=<a real sku> in this one.
 *   3. `npm run e2e`
 */
const shouldRun = Boolean(process.env.RUN_E2E);

test.describe("cart to paid order", () => {
  test.skip(!shouldRun, "requires netlify dev + Stripe/Supabase test-mode credentials (see file header)");

  test("customer can add an item, check out, pay with a Stripe test card, and land back on a success page", async ({
    page,
  }) => {
    const sku = process.env.E2E_TEST_SKU;
    if (!sku) throw new Error("Set E2E_TEST_SKU to a real, in-stock product SKU before running this test.");

    await page.goto("/");

    const addToCartButton = page.locator(`.add-cart-btn[data-sku="${sku}"]`);
    await addToCartButton.scrollIntoViewIfNeeded();
    await addToCartButton.click();
    await expect(page.locator("#cartCount")).toHaveText("1");

    await page.locator("#cartToggle").click();
    await page.locator('[data-action="checkout"]').click();

    await page.fill("#ck-name", "E2E Test");
    await page.fill("#ck-phone", "91234567");
    await page.fill("#ck-email", "e2e-test@example.com");
    await page.fill("#ck-address", "1 Test Street");
    await page.fill("#ck-postal", "123456");
    await page.locator('input[name="ageConfirmed"]').check();

    await page.locator('button[type="submit"]').click();

    // Stripe's hosted Checkout page — a real cross-origin navigation.
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
    await page.fill('input[name="cardNumber"]', "4242424242424242");
    await page.fill('input[name="cardExpiry"]', "12/34");
    await page.fill('input[name="cardCvc"]', "123");
    await page.fill('input[name="billingName"]', "E2E Test");
    await page.getByRole("button", { name: /pay/i }).click();

    await page.waitForURL(/checkout=success/, { timeout: 20000 });
    await expect(page).toHaveURL(/checkout=success/);

    // A real assertion of order state would query Supabase directly here
    // (order.status === 'paid', inventory_reservations status === 'confirmed')
    // once a service-role test client is wired into this suite.
  });

  test("checkout is rejected server-side without age confirmation, even if the client were bypassed", async ({
    request,
  }) => {
    const sku = process.env.E2E_TEST_SKU;
    if (!sku) throw new Error("Set E2E_TEST_SKU to a real, in-stock product SKU before running this test.");

    const res = await request.post("/.netlify/functions/create-checkout-session", {
      data: {
        items: [{ sku, qty: 1 }],
        deliveryMethod: "standard",
        recipient: {
          name: "E2E Test",
          phone: "91234567",
          email: "e2e-test@example.com",
          address: "1 Test Street",
          postalCode: "123456",
          notes: "",
        },
        ageConfirmed: false,
      },
    });
    expect(res.status()).toBe(400);
  });
});

import { test, expect, type Page, type Frame } from "@playwright/test";

/**
 * Payment Element (CHECKOUT_UI_MODE=elements) differential regression.
 *
 * Interacts with Stripe's real cross-origin Payment Element iframe via
 * Playwright's own Chromium automation (page.frame() / frame locators) —
 * never coordinate clicks, never reaching into the iframe via page-executed
 * JS (which same-origin policy would block anyway). This is the only
 * reliable way found to drive that iframe in this project; see
 * PROJECT_STATUS.md for why a browser-extension-based automation tool was
 * abandoned for this specific test.
 *
 * Skipped by default — needs `netlify dev` running with Stripe *test-mode*
 * keys and CHECKOUT_UI_MODE=elements / CHECKOUT_ENABLED=true (see .env).
 * Run one test at a time (each spends one of create-checkout-session's
 * IP rate-limit slots — 5 per rolling 10 minutes, shared with every other
 * local checkout attempt against the same dev server):
 *
 *   1. `netlify dev` in one terminal, `npm run dev` (vite watch) in another.
 *   2. RUN_E2E_ELEMENTS=1 E2E_TEST_SKU=<a real, in-stock sku> \
 *        npx playwright test tests/e2e/payment-element.spec.ts -g "<test name>"
 */
const shouldRun = Boolean(process.env.RUN_E2E_ELEMENTS);
const SKU = process.env.E2E_TEST_SKU ?? "";

// The official Stripe test cards (test mode only, never valid for real
// charges) — see https://docs.stripe.com/testing.
const CARD_SUCCESS = "4242424242424242";
const CARD_3DS = "4000002500003155"; // "Requires authentication" — 3D Secure challenge

test.describe("Payment Element regression", () => {
  test.skip(!shouldRun, "requires netlify dev with CHECKOUT_UI_MODE=elements (see file header)");

  test.beforeEach(() => {
    if (!SKU) throw new Error("Set E2E_TEST_SKU to a real, in-stock product SKU before running this suite.");
  });

  // Netlify injects its own "Deploy Preview" inspector toolbar (a fixed-
  // position div wrapping an iframe to app.netlify.com) into every Deploy
  // Preview page — real customers on the eventual Production domain never
  // see this. At narrow viewport widths it can overlap and intercept clicks
  // on our own footer buttons. Hiding it is a Deploy-Preview-only test
  // concession, not a workaround for a real layout bug.
  async function hideNetlifyDeployPreviewToolbar(page: Page): Promise<void> {
    await page.evaluate(() => {
      document.querySelectorAll<HTMLElement>("[data-netlify-deploy-id]").forEach((el) => {
        el.style.display = "none";
      });
    });
  }

  /** Clicks the checkout form's submit button and returns create-checkout-session's parsed JSON body. */
  async function submitCheckoutFormAndCapture(page: Page): Promise<{ orderId: string; mode: string }> {
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/create-checkout-session") && r.request().method() === "POST"),
      page.locator('button[type="submit"]').click(),
    ]);
    const body = await response.json();
    await expect(page.locator("#ck-payment-element iframe").first()).toBeVisible({ timeout: 20000 });
    await expect
      .poll(() => page.frame({ url: /elements-inner-payment/ }), { timeout: 20000 })
      .not.toBeNull();
    return body;
  }

  async function reachPaymentStep(
    page: Page,
    email: string,
    viewport: { width: number; height: number } = { width: 1280, height: 2200 }
  ): Promise<{ orderId: string; mode: string }> {
    // Tall by default so the expanded Card accordion (fields + country
    // dropdown + AI-agent disclosure) never needs scrolling to reach —
    // frame-locator clicks compute real page coordinates, and an element
    // genuinely below the fold fails actionability even after Playwright's
    // own auto-scroll. The responsive-layout test overrides this with its
    // own deliberately narrow widths, since it never expands that accordion.
    await page.setViewportSize(viewport);
    await page.goto("/");
    await hideNetlifyDeployPreviewToolbar(page);
    const addToCartButton = page.locator(`.add-cart-btn[data-sku="${SKU}"]`);
    await addToCartButton.scrollIntoViewIfNeeded();
    await addToCartButton.click();
    await expect(page.locator("#cartCount")).toHaveText("1");

    await page.locator("#cartToggle").click();
    await page.locator('[data-action="checkout"]').click();
    await page.locator('[data-action="continue-guest"]').click();

    await page.fill("#ck-name", "Payment Element E2E");
    await page.fill("#ck-phone", "91234567");
    await page.fill("#ck-email", email);
    await page.fill("#ck-address", "1 Test Street");
    await page.fill("#ck-postal", "123456");
    await page.locator('input[name="ageConfirmed"]').check();

    // The Payment Element mounts asynchronously once create-checkout-session
    // returns and stripe.js loads the iframe tree.
    return submitCheckoutFormAndCapture(page);
  }

  /** The real "Secure payment input frame" — Card/PayNow tabs and their fields all live here. */
  function getPaymentFrame(page: Page): Frame {
    const frame = page.frame({ url: /elements-inner-payment/ });
    if (!frame) throw new Error("Stripe elements-inner-payment frame not found");
    return frame;
  }

  async function fillCardTab(page: Page, frame: Frame, cardNumber: string): Promise<void> {
    await frame.getByRole("button", { name: "Card" }).click();
    // The accordion's expanded Card content (fields + country dropdown +
    // disclosure text) is taller than the drawer's visible area, and the
    // drawer body is its own overflow:auto container — the outer page must
    // scroll *that* into view before a frame-locator click's computed
    // coordinates land inside the actual browser viewport.
    await page.locator("#ck-payment-element").scrollIntoViewIfNeeded();
    await frame.getByLabel(/card number/i).fill(cardNumber);
    await frame.getByLabel(/expiration/i).fill("12/34");
    await frame.getByLabel(/^cvc$|security code/i).fill("123");
    const nameField = frame.getByLabel(/^name on card$|cardholder name/i);
    if (await nameField.count()) await nameField.fill("Payment Element E2E");
    await checkAiAgentDisclosureIfPresent(page, frame);
  }

  // Stripe's agentic-commerce disclosure checkbox — this suite genuinely is
  // an AI agent (Playwright) acting on the site owner's behalf, so it's
  // checked truthfully rather than avoided or routed around. Its backing
  // <input> reports a real, positive bounding box but a pointer click at
  // that box's coordinates is consistently rejected as "outside of
  // viewport" regardless of window size or scroll position — some
  // transform/clip on an ancestor Playwright's actionability check can't
  // see through. Rather than fight that with more coordinate/scroll
  // workarounds (exactly what this whole test suite exists to avoid),
  // this drives the checkbox directly via Frame.evaluate(): standard
  // Playwright frame automation (same CDP-backed mechanism .fill() itself
  // uses), executed inside the Stripe frame's own realm — not a
  // cross-origin reach-in from the parent page, and not an absolute
  // coordinate click.
  async function checkAiAgentDisclosureIfPresent(_page: Page, frame: Frame): Promise<void> {
    const label = frame.getByText(/AI agent acting on behalf/i);
    if (!(await label.count())) return;
    const input = frame
      .locator("label")
      .filter({ hasText: /AI agent acting on behalf/i })
      .locator('input[type="checkbox"]');
    await input.evaluate((el: HTMLInputElement) => {
      el.checked = true;
      el.dispatchEvent(new Event("click", { bubbles: true }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  test("Card 4242 completes successfully", async ({ page }) => {
    await reachPaymentStep(page, `pe-card-4242-${Date.now()}@example.com`);
    const frame = getPaymentFrame(page);
    await fillCardTab(page, frame, CARD_SUCCESS);

    await page.locator('[data-action="confirm-payment"]').click();
    await expect(page.getByText(/Payment received|支付成功/)).toBeVisible({ timeout: 30000 });
  });

  test("official Stripe 3DS test card: never gets stuck on bare PROCESSING forever, and never allows a duplicate submit", async ({
    page,
  }) => {
    // Regression test for a real, twice-reproduced-in-real-Chrome bug: Stripe's
    // actions.confirm() can simply never resolve after this 3DS2 test card's
    // challenge is completed, even though the Checkout Session itself
    // genuinely gets marked paid on Stripe's side within seconds. The fix
    // (src/lib/payment-confirmation.ts) races confirm() against a bounded
    // poll of the Checkout Session's own status, so this test needs enough
    // real time to observe that race actually happen, not just the redirect.
    test.setTimeout(90_000);
    await reachPaymentStep(page, `pe-3ds-${Date.now()}@example.com`);
    const frame = getPaymentFrame(page);
    await fillCardTab(page, frame, CARD_3DS);

    await page.locator('[data-action="confirm-payment"]').click();

    // This 3DS2 test card resolves without a top-level navigation — Stripe
    // injects an in-page modal (an iframe nested inside another iframe)
    // showing its "3D Secure 2 Test Page" with Fail/Complete buttons, which
    // confirm({redirect:"if_required"}) doesn't need to leave the page for
    // (no redirect required for this specific challenge type). Found by
    // polling page.frames() for whichever frame has that Complete button,
    // rather than assuming a fixed nesting depth or URL shape.
    let completeButtonFrame: Frame | null = null;
    await expect
      .poll(
        async () => {
          for (const f of page.frames()) {
            if (await f.getByRole("button", { name: "Complete" }).count().catch(() => 0)) {
              completeButtonFrame = f;
              return true;
            }
          }
          return false;
        },
        { timeout: 20000, message: "Stripe's 3DS challenge frame (with a 'Complete' button) never appeared" }
      )
      .toBe(true);

    await completeButtonFrame!.getByRole("button", { name: "Complete" }).click();

    // The PAY NOW button must stay disabled throughout — whether confirm()
    // resolves quickly, the payment succeeds via the status-poll fallback
    // instead, or it's still genuinely uncertain — the customer must never
    // be able to trigger a second confirm on an already-in-flight payment.
    const payButton = page.locator('[data-action="confirm-payment"]');
    await expect(payButton).toBeDisabled();

    // Whatever actually happens next (confirm() resolves, or the bounded
    // status poll catches "paid" first, or genuine timeout), the customer
    // must land on one of exactly two outcomes within a bounded time —
    // never a bare "PROCESSING…" forever, and never the generic scary
    // "Something went wrong" error for what may well be a successful payment.
    const success = page.getByText(/Payment received|支付成功/);
    const uncertain = page.getByText(/still confirming your payment|仍在向银行确认您的付款/i);
    await expect(success.or(uncertain)).toBeVisible({ timeout: 70_000 });

    if (await uncertain.isVisible().catch(() => false)) {
      // Still in the payment view (drawer wasn't closed) — confirm the
      // button really is disabled, not just visually similar.
      await expect(payButton).toBeDisabled();
      await expect(payButton).toHaveText(/Confirming your payment|正在确认付款/);
    }
  });

  test("PayNow can be selected and reaches its QR-code step", async ({ page }) => {
    test.setTimeout(60_000);
    await reachPaymentStep(page, `pe-paynow-${Date.now()}@example.com`);
    const frame = getPaymentFrame(page);
    await frame.getByRole("button", { name: "PayNow" }).click();
    await checkAiAgentDisclosureIfPresent(page, frame);

    await page.locator('[data-action="confirm-payment"]').click();

    // Learned from the 3DS test above: this SDK doesn't necessarily leave
    // the page for an out-of-band method — it may show the QR via an
    // injected in-page frame instead of a real top-level navigation. Poll
    // both: whichever happens, find wherever a QR-bearing element actually
    // rendered (top page, or any frame) rather than assuming one shape.
    let qrLocation: { root: Page | Frame; qr: ReturnType<Page["locator"]> } | null = null;
    await expect
      .poll(
        async () => {
          const roots: Array<Page | Frame> = [page, ...page.frames()];
          for (const root of roots) {
            const qr = root.locator('img[src*="qr" i], canvas, [class*="qr" i], svg[class*="qr" i]').first();
            if (await qr.count().catch(() => 0)) {
              qrLocation = { root, qr };
              return true;
            }
          }
          return false;
        },
        { timeout: 30000, message: "No QR-bearing element appeared in the top page or any frame after confirming PayNow" }
      )
      .toBe(true);

    await expect(qrLocation!.qr).toBeVisible({ timeout: 10000 });
  });

  test("resuming after Back reuses the same order/session — no duplicate order or reservation", async ({ page }) => {
    const email = `pe-resume-${Date.now()}@example.com`;
    const first = await reachPaymentStep(page, email);

    await page.locator('[data-action="back"]').click();
    await expect(page.locator("#ck-name")).toBeVisible();

    // Same checkoutAttemptId (only regenerated by goToCheckout(), which
    // "Back" from the payment stage never calls — see cart.ts's
    // handleBack()), so create-checkout-session.ts's idempotency check
    // must return the existing order rather than minting a new one.
    const second = await submitCheckoutFormAndCapture(page);

    expect(second.orderId).toBe(first.orderId);

    // The stronger DB-level assertion (exactly one orders row / one active
    // reservation for this email) is verified separately via SQL in the
    // cleanup pass, not duplicated here with a second Supabase client.
  });

  // One checkout reused across all four widths via setViewportSize (not one
  // new order per width) — this is a pure CSS/layout property, and each new
  // order would otherwise burn its own IP rate-limit slot for no reason.
  test("Payment Element has no layout overflow and stays usable at 375/390/412px and desktop", async ({ page }) => {
    test.setTimeout(60_000);
    await reachPaymentStep(page, `pe-responsive-${Date.now()}@example.com`, { width: 412, height: 900 });
    const frame = getPaymentFrame(page);

    const widths = [375, 390, 412, 1280];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300); // let the Payment Element's own resize observer settle

      const actualWidth = await page.evaluate(() => window.innerWidth);
      expect(actualWidth).toBe(width);

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(width);

      await expect(frame.getByRole("button", { name: "Card" }), `Card tab hidden at ${width}px`).toBeVisible();
      await expect(frame.getByRole("button", { name: "PayNow" }), `PayNow tab hidden at ${width}px`).toBeVisible();

      const payButton = page.locator('[data-action="confirm-payment"]');
      await expect(payButton, `PAY NOW button hidden at ${width}px`).toBeVisible();
      await expect(payButton, `PAY NOW button not clickable at ${width}px`).toBeEnabled();

      // Truncation check: the total is a fixed, known string at this SKU —
      // if it's clipped/wrapped into an ellipsis by a too-narrow layout,
      // this exact text match fails.
      await expect(page.getByText("S$100.00")).toBeVisible();
    }
  });
});

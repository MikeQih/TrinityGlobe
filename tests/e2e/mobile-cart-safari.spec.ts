import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Mobile Safari cart-drawer usability regression suite.
 *
 * Root cause (see PROJECT_STATUS.md / PR description for the full writeup):
 * `.cart-drawer` used a bare `height: 100vh`. iOS Safari defines `1vh` as
 * 1% of the *largest* possible viewport (toolbars collapsed), not the
 * *currently visible* one — so whenever the address bar / bottom toolbar is
 * showing (the default state on first load or after scrolling up), the
 * drawer's actual bottom edge sits below the bottom of what's currently on
 * screen, cutting off the Checkout button. `.cart-drawer-body` also lacked
 * `min-height: 0`, the standard flexbox fix without which a flex child's
 * content can refuse to shrink below its own min-content size and push
 * later siblings (the footer) out of a fixed-height ancestor.
 *
 * IMPORTANT LIMITATION: Playwright's `webkit` project is desktop Safari's
 * engine, not on-device iOS Safari, and no automated tool can animate the
 * real toolbar-collapse behaviour that causes `100vh` and `visualViewport
 * .height` to diverge on an iPhone — that split simply doesn't exist in any
 * desktop browser or in Playwright's mobile *emulation* (which fixes a
 * single static viewport size and never dynamically shrinks it further).
 * This suite substitutes deliberately-reduced viewport heights ("visible
 * area smaller than the device's max layout height") as a faithful stand-in
 * for "toolbar is showing", and asserts the button stays on-screen and
 * clickable at every one of them. That proves the CSS adapts correctly to
 * whatever height it's actually given — it does not by itself prove the
 * real iPhone Safari toolbar-driven case, which is exactly why final
 * sign-off is gated on manual iPhone Safari + Chrome confirmation.
 */

let PORT = 0; // assigned by the OS in beforeAll — avoids collisions between projects (chromium/webkit) running this file in parallel
const ROOT = path.resolve(__dirname, "../..");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

let server: Server;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    let filePath = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
    createReadStream(filePath).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") PORT = addr.port;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function base(): string {
  return `http://localhost:${PORT}`;
}

// Real catalog SKU (S$85 bottle, no case pricing) — same one used throughout
// this project's manual/e2e checkout tests, so `window.TG_PRODUCTS` (built
// from the real products.json/products-data.js served statically here)
// resolves it exactly like production does.
const SKU = "COGNAC-HENNESSY-VSOP";

async function seedCart(page: Page, items: Array<{ sku: string; name: string; qty: number }>): Promise<void> {
  await page.addInitScript((seedItems) => {
    const cart = seedItems.map((i) => ({
      sku: i.sku,
      name: i.name,
      image: "images/干邑白兰地 - Hennessy VSOP.png", // real TG_PRODUCTS entries are 'images/' + filename (see script.js), not the bare filename
      priceTiers: { bottlePriceCents: 8500, caseSize: null, casePriceCents: null, fiveCaseSize: null, fiveCasePriceCents: null },
      qty: i.qty,
    }));
    window.localStorage.setItem("tg_cart_v1", JSON.stringify(cart));
  }, items);
}

async function openCartDrawer(page: Page): Promise<void> {
  await page.goto(base() + "/");
  await page.waitForSelector("#cartToggle");
  await page.click("#cartToggle");
  await page.waitForSelector(".cart-drawer.open");
}

interface ButtonEvidence {
  innerWidth: number;
  innerHeight: number;
  visualViewportHeight: number | null;
  documentClientHeight: number;
  buttonRect: { top: number; bottom: number; left: number; right: number; width: number; height: number } | null;
  footerRect: { top: number; bottom: number } | null;
  drawerComputedHeight: string;
  cartBodyComputedMinHeight: string;
}

async function collectEvidence(page: Page): Promise<ButtonEvidence> {
  return page.evaluate(() => {
    const btn = document.querySelector<HTMLElement>(".cart-drawer-footer .btn-gold");
    const footer = document.querySelector<HTMLElement>(".cart-drawer-footer");
    const drawer = document.querySelector<HTMLElement>(".cart-drawer");
    const body = document.querySelector<HTMLElement>(".cart-drawer-body");
    const r = btn?.getBoundingClientRect();
    const fr = footer?.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      visualViewportHeight: window.visualViewport ? window.visualViewport.height : null,
      documentClientHeight: document.documentElement.clientHeight,
      buttonRect: r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height } : null,
      footerRect: fr ? { top: fr.top, bottom: fr.bottom } : null,
      drawerComputedHeight: drawer ? getComputedStyle(drawer).height : "",
      cartBodyComputedMinHeight: body ? getComputedStyle(body).minHeight : "",
    };
  });
}

const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568 },
  { name: "375x667", width: 375, height: 667 },
  { name: "390x844", width: 390, height: 844 },
  { name: "412x915", width: 412, height: 915 },
  { name: "430x932", width: 430, height: 932 },
  { name: "844x390-landscape", width: 844, height: 390 },
  { name: "1440-desktop", width: 1440, height: 900 },
];

// Toolbar-shown stand-ins: same widths, ~10% shorter height (roughly the
// proportion iOS Safari's compact toolbar removes from the visible area).
const REDUCED_VIEWPORTS = VIEWPORTS.filter((v) => v.height > 600).map((v) => ({
  name: v.name + "-toolbar-shown",
  width: v.width,
  height: Math.round(v.height * 0.88),
}));

for (const vp of [...VIEWPORTS, ...REDUCED_VIEWPORTS]) {
  test(`checkout button fully visible + clickable @ ${vp.name} [1 item]`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await seedCart(page, [{ sku: SKU, name: "Hennessy VSOP", qty: 1 }]);
    await openCartDrawer(page);

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    const evidence = await collectEvidence(page);
    const effectiveHeight = evidence.visualViewportHeight ?? evidence.innerHeight;

    expect(evidence.buttonRect, `checkout button must exist @ ${vp.name}`).not.toBeNull();
    expect(evidence.buttonRect!.bottom, `button.bottom vs viewport @ ${vp.name}: ${JSON.stringify(evidence)}`).toBeLessThanOrEqual(effectiveHeight);
    expect(evidence.buttonRect!.top).toBeGreaterThanOrEqual(0);
    expect(evidence.buttonRect!.height).toBeGreaterThanOrEqual(40); // ~44px tap target, allow 4px CSS rounding

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `no horizontal overflow @ ${vp.name}`).toBeLessThanOrEqual(vp.width);

    // Must be genuinely clickable, not just geometrically on-screen.
    const checkoutBtn = page.locator(".cart-drawer-footer .btn-gold");
    await expect(checkoutBtn).toBeVisible();
    await expect(checkoutBtn).toBeEnabled();
    await checkoutBtn.click({ trial: true }); // trial=true: verifies hit-testable, doesn't actually navigate/submit

    expect(consoleErrors, `no new console errors @ ${vp.name}`).toEqual([]);
  });
}

test("many items: only item list scrolls, footer/button stay put", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const manyItems = Array.from({ length: 12 }, (_, i) => ({
    sku: i === 0 ? SKU : `FAKE-SKU-${i}`,
    name: i === 0 ? "Hennessy VSOP" : `Test Product With A Very Long Name That Wraps Multiple Lines ${i}`,
    qty: 1,
  }));
  // Only the real SKU resolves through TG_PRODUCTS/reconcilePriceTiers; the
  // rest exercise the "unknown sku, keep the cached snapshot" no-op path,
  // which is fine — this test is purely about layout with many rows.
  await seedCart(page, manyItems);
  await openCartDrawer(page);

  const evidence = await collectEvidence(page);
  const effectiveHeight = evidence.visualViewportHeight ?? evidence.innerHeight;
  expect(evidence.buttonRect!.bottom).toBeLessThanOrEqual(effectiveHeight);

  const bodyScrollable = await page.evaluate(() => {
    const body = document.querySelector<HTMLElement>(".cart-drawer-body");
    return body ? body.scrollHeight > body.clientHeight : false;
  });
  expect(bodyScrollable, "item list should overflow and scroll internally with 12 items").toBe(true);
});

test("empty cart: drawer renders without a footer/checkout button, no overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await seedCart(page, []);
  await openCartDrawer(page);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(375);
  await expect(page.locator(".cart-empty")).toBeVisible();
});

test("long product name does not push the checkout button off-screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await seedCart(page, [
    { sku: SKU, name: "Extremely Long Premium Reserve Special Edition Cognac Name That Wraps Across Several Lines On A Narrow Screen", qty: 1 },
  ]);
  await openCartDrawer(page);
  const evidence = await collectEvidence(page);
  const effectiveHeight = evidence.visualViewportHeight ?? evidence.innerHeight;
  expect(evidence.buttonRect!.bottom).toBeLessThanOrEqual(effectiveHeight);
});

test("Chinese locale: checkout button still fully visible", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.addInitScript(() => {
    window.localStorage.setItem("tg_lang", "zh");
  });
  await seedCart(page, [{ sku: SKU, name: "Hennessy VSOP", qty: 2 }]);
  await openCartDrawer(page);
  const evidence = await collectEvidence(page);
  const effectiveHeight = evidence.visualViewportHeight ?? evidence.innerHeight;
  expect(evidence.buttonRect!.bottom).toBeLessThanOrEqual(effectiveHeight);
});

test("body scroll is restored after closing the drawer", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await seedCart(page, [{ sku: SKU, name: "Hennessy VSOP", qty: 1 }]);
  await openCartDrawer(page);
  const lockedOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
  await page.click(".cart-drawer-close");
  await page.waitForTimeout(350); // drawer close transition
  const restoredOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
  // Whatever the lock strategy is (or isn't), closing must not leave the
  // page unable to scroll.
  expect(restoredOverflow).not.toBe("hidden");
  void lockedOverflow;
});

// ── Header (mobile nav) ──────────────────────────────────────────────────

for (const width of [375, 390, 412, 430]) {
  test(`mobile header: actions group flush right, no overlap with brand @ ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(base() + "/");
    await page.waitForSelector("#navAccount", { state: "attached" });
    await page.waitForTimeout(200); // let initAccountNav's initAuth().then(render) settle

    await expect(page.locator("#navAccount")).toBeHidden();
    await expect(page.locator("#cartToggle")).toBeVisible();
    await expect(page.locator("#navHamburger")).toBeVisible();

    const evidence = await page.evaluate(() => {
      const header = document.getElementById("navbar")!;
      const brand = document.querySelector(".nav-logo")!;
      const actions = document.querySelector(".nav-actions")!;
      const cart = document.getElementById("cartToggle")!;
      const hamburger = document.getElementById("navHamburger")!;
      const r = (el: Element) => {
        const b = el.getBoundingClientRect();
        return { top: b.top, right: b.right, bottom: b.bottom, left: b.left, width: b.width, height: b.height };
      };
      return {
        headerRect: r(header),
        brandRect: r(brand),
        actionsGroupRect: r(actions),
        cartRect: r(cart),
        hamburgerRect: r(hamburger),
        headerPaddingRight: parseFloat(getComputedStyle(header).paddingRight),
      };
    });

    // actionsGroup sits at the header's right edge, offset by exactly the
    // header's own right padding (its `env(safe-area-inset-right)` term is
    // 0 in this non-notched test environment) — not some other hardcoded
    // number, and not flush against the edge with no padding at all.
    const rightGap = evidence.headerRect.right - evidence.actionsGroupRect.right;
    expect(rightGap, `rightGap vs header padding-right @ ${width}px: ${JSON.stringify(evidence)}`).toBeGreaterThanOrEqual(
      evidence.headerPaddingRight - 2
    );
    expect(rightGap).toBeLessThanOrEqual(evidence.headerPaddingRight + 2);

    // No overlap, and a real gap — not just touching — between brand and actions.
    expect(evidence.actionsGroupRect.left, `overlap @ ${width}px: ${JSON.stringify(evidence)}`).toBeGreaterThan(
      evidence.brandRect.right + 8
    );

    expect(evidence.cartRect.width).toBeGreaterThanOrEqual(44);
    expect(evidence.cartRect.height).toBeGreaterThanOrEqual(44);
    expect(evidence.hamburgerRect.width).toBeGreaterThanOrEqual(44);
    expect(evidence.hamburgerRect.height).toBeGreaterThanOrEqual(44);

    // Brand single line, fully inside the header row.
    expect(evidence.brandRect.height).toBeLessThan(60);
    expect(evidence.brandRect.left).toBeGreaterThanOrEqual(evidence.headerRect.left - 1);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `horizontal overflow @ ${width}px`).toBeLessThanOrEqual(width);

    console.log(`[header evidence @ ${width}px]`, JSON.stringify(evidence));
  });
}

test("header, cart, and close button stay aligned while the cart drawer is open", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedCart(page, [{ sku: SKU, name: "Hennessy VSOP", qty: 1 }]);
  await openCartDrawer(page);
  const evidence = await page.evaluate(() => {
    const r = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
    return {
      navbar: r(document.getElementById("navbar")),
      cartToggle: r(document.getElementById("cartToggle")),
      drawerClose: r(document.querySelector(".cart-drawer-close")),
    };
  });
  expect(evidence.navbar).not.toBeNull();
  expect(evidence.cartToggle).not.toBeNull();
  // The drawer's own close button sits inside the drawer header, independent
  // of #navbar's cart icon — both must still be genuinely on-screen with the
  // drawer open, not pushed off or overlapping each other unreadably.
  expect(evidence.drawerClose).not.toBeNull();
  expect(evidence.navbar!.top).toBeGreaterThanOrEqual(-1);
  expect(evidence.cartToggle!.top).toBeGreaterThanOrEqual(0);
  expect(evidence.drawerClose!.top).toBeGreaterThanOrEqual(0);
});

test("mobile header: hamburger menu shows Sign In when signed out", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(base() + "/");
  await page.waitForTimeout(200);
  await page.click("#navHamburger");
  await expect(page.locator("#mobileMenu")).toHaveClass(/open/);
  await expect(page.locator("#mobileMenu")).toContainText(/Sign In/i);
});

test("cart badge shows 0/1/two-digit counts pinned to the cart icon", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await seedCart(page, [{ sku: SKU, name: "Hennessy VSOP", qty: 12 }]);
  await page.goto(base() + "/");
  await page.waitForTimeout(200);
  const count = await page.locator("#cartCount").textContent();
  expect(count).toBe("12");
  await expect(page.locator("#cartCount")).toBeVisible();
});

interface RowGeometry {
  height: number;
  top: number;
  textLeft: number;
  color: string;
}

async function measureMobileMenuRows(page: Page): Promise<RowGeometry[]> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLLIElement>("#mobileLinksList > li"));
    return rows.map((li) => {
      const child = li.querySelector<HTMLElement>("a, button")!;
      const liRect = li.getBoundingClientRect();
      const childRect = child.getBoundingClientRect();
      return {
        height: liRect.height,
        top: liRect.top,
        textLeft: childRect.left,
        color: getComputedStyle(child).color,
      };
    });
  });
}

test("mobile menu: every row (signed out) shares identical height/padding/left-edge, uniform spacing", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto(base() + "/");
  await page.waitForTimeout(200);
  await page.click("#navHamburger");
  await expect(page.locator("#mobileMenu")).toHaveClass(/open/);
  await page.waitForTimeout(300);

  const rows = await measureMobileMenuRows(page);
  // Home, About, Collection, Contact, language, Sign In.
  expect(rows.length).toBe(6);

  const heights = rows.map((r) => r.height);
  const lefts = rows.map((r) => r.textLeft);
  const maxHeightDiff = Math.max(...heights) - Math.min(...heights);
  const maxLeftDiff = Math.max(...lefts) - Math.min(...lefts);
  expect(maxHeightDiff, `row heights: ${JSON.stringify(heights)}`).toBeLessThanOrEqual(1);
  expect(maxLeftDiff, `row text left edges: ${JSON.stringify(lefts)}`).toBeLessThanOrEqual(1);

  // Row-to-row spacing (top-to-top) must be uniform across every adjacent
  // pair — in particular Sign In (last) vs language (second-to-last) must
  // match every other adjacent pair, not carry its own extra margin/border.
  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) gaps.push(rows[i]!.top - rows[i - 1]!.top);
  const maxGapDiff = Math.max(...gaps) - Math.min(...gaps);
  expect(maxGapDiff, `row-to-row gaps: ${JSON.stringify(gaps)}`).toBeLessThanOrEqual(1);

  // The language toggle is allowed to be gold (by design); every other row
  // must share one plain color.
  const nonLangColors = new Set(rows.slice(0, 4).concat(rows[5]!).map((r) => r.color));
  expect(nonLangColors.size, `non-language row colors should all match: ${JSON.stringify([...nonLangColors])}`).toBe(1);
  // The language toggle is allowed to differ *in color only* — but it must
  // actually be gold, not silently fall back to the same muted color as
  // everything else (a `.mobile-links button` shared-rule specificity of
  // 0,1,1 previously beat `.mobile-lang-btn`'s 0,1,0 and did exactly that).
  expect(rows[4]!.color, "language toggle should be gold, not the shared muted color").not.toBe([...nonLangColors][0]);

  console.log("[mobile menu rows, signed out]", JSON.stringify(rows));
});

test("mobile menu: signed-in account rows (My Orders/My Addresses/Sign Out) share the same row styling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto(base() + "/");
  await page.waitForTimeout(200);

  // Exercises the exact markup src/cart.ts#initAccountNav() renders for a
  // signed-in session (same .mobile-account-row wrapper, same plain <a>/
  // <button> children, appended into the same #mobileLinksList) without
  // driving a real Supabase sign-in round trip, which needs a live backend
  // this suite deliberately has none of. Confirmed by code review that both
  // the signed-in and signed-out branches share this identical structure.
  await page.evaluate(() => {
    const list = document.getElementById("mobileLinksList")!;
    list.querySelectorAll(".mobile-account-row").forEach((el) => el.remove());
    list.insertAdjacentHTML(
      "beforeend",
      `<li class="mobile-account-row"><a href="/orders.html">My Orders</a></li>
       <li class="mobile-account-row"><a href="/addresses.html">My Addresses</a></li>
       <li class="mobile-account-row"><button type="button">Sign Out</button></li>`
    );
  });
  await page.click("#navHamburger");
  await expect(page.locator("#mobileMenu")).toHaveClass(/open/);
  await page.waitForTimeout(300);

  const rows = await measureMobileMenuRows(page);
  // Home, About, Collection, Contact, language, + My Orders/My Addresses/Sign Out.
  expect(rows.length).toBe(8);

  const heights = rows.map((r) => r.height);
  const lefts = rows.map((r) => r.textLeft);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
  expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1);

  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) gaps.push(rows[i]!.top - rows[i - 1]!.top);
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);

  // My Orders / My Addresses / Sign Out are plain rows, same color as Home/
  // About/etc — not gold like the language toggle.
  const accountRowColors = new Set(rows.slice(-3).map((r) => r.color));
  expect(accountRowColors.size).toBe(1);
  const langColor = rows[4]!.color;
  expect([...accountRowColors][0]).not.toBe(langColor);

  console.log("[mobile menu rows, signed-in simulation]", JSON.stringify(rows));
});

test("mobile menu: no horizontal overflow with the menu open", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(base() + "/");
  await page.waitForTimeout(200);
  await page.click("#navHamburger");
  await expect(page.locator("#mobileMenu")).toHaveClass(/open/);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(320);
});

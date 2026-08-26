import {
  ApiError,
  cancelMyOrder,
  fetchLivePrices,
  fetchMyOrders,
  resumeCheckoutSession,
} from "./api-client";
import { getSession, initAuth, onAuthChange } from "./auth";
import { showToast, paymentElementAppearance } from "./cart";
import { CartStore } from "./cart-store";
import { escapeAttr, escapeHtml } from "./html-escape";
import { formatCents, onLangChange, t } from "./i18n";
import { getStripeClient } from "./lib/stripe-elements";
import type { StripeCheckoutElementsSdk } from "@stripe/stripe-js";
import type { MyOrder, OrderStatus, ProductSummary } from "./types";

const WHATSAPP_URL = "https://wa.me/6598680555";

// Several DB statuses read as one customer-facing bucket — the fulfilment
// sub-steps (paid vs. preparing, ready-for-collection vs. out-for-delivery)
// aren't meaningful to a customer yet, only to staff in admin-app. See the
// MVP status table this was designed against: pending_payment → paid/
// processing → shipped → completed, plus the terminal side-states.
type StatusBucket =
  | "pending_payment"
  | "processing"
  | "shipped"
  | "completed"
  | "cancelled"
  | "payment_failed"
  | "refunded"
  | "payment_review";

function customerStatusBucket(status: OrderStatus): StatusBucket {
  switch (status) {
    case "pending_payment":
      return "pending_payment";
    case "paid":
    case "preparing":
      return "processing";
    case "ready_for_collection":
    case "out_for_delivery":
      return "shipped";
    case "completed":
      return "completed";
    case "cancelled":
    case "expired":
      return "cancelled";
    case "payment_failed":
      return "payment_failed";
    case "refunded":
      return "refunded";
    case "payment_review":
      return "payment_review";
  }
}

// "cancelled" the DB status and "expired" the DB status both bucket to
// "cancelled" above (same action: buy again), but still deserve visibly
// different labels — a customer who never got expired should not read
// "Payment Expired" for a card they explicitly cancelled, or vice versa.
function statusLabelKey(status: OrderStatus): string {
  if (status === "expired") return "order-status-expired";
  return `order-status-${customerStatusBucket(status)}`;
}

// Drives the list filter tabs — collapses the terminal "nothing left to do"
// statuses under "closed" so cancelled/expired test orders don't dominate
// the default view (see PROJECT_STATUS.md's My Orders redesign notes).
function filterBucket(status: OrderStatus): "active" | "closed" {
  const bucket = customerStatusBucket(status);
  return bucket === "completed" || bucket === "cancelled" || bucket === "refunded" ? "closed" : "active";
}

function paymentStatusLabelKey(status: OrderStatus): string {
  switch (status) {
    case "pending_payment":
      return "order-status-pending_payment";
    case "payment_failed":
      return "order-status-payment_failed";
    case "expired":
      return "order-status-expired";
    case "cancelled":
      return "order-status-cancelled";
    case "payment_review":
      return "order-status-payment_review";
    case "refunded":
      return "order-status-refunded";
    default:
      return "order-status-processing"; // reused here just for its "paid" wording — see orders-i18n.js
  }
}

type Filter = "all" | "active" | "closed";

export function initOrdersPage(): void {
  const root = document.getElementById("myOrdersRoot");
  if (!root) return;

  let orders: MyOrder[] = [];
  let view: "list" | "detail" = "list";
  let selectedOrderId: string | null = null;
  let filter: Filter = "all";
  let confirmingCancelId: string | null = null;
  let actionBusy = false;
  let actionErrorKey: string | null = null;
  let requestId = 0;
  let expiryTimer: number | null = null;

  // Payment Element mount state for the "继续付款" flow — same shape as
  // src/cart.ts's checkoutSdk/paymentOrderId/paymentConfirming, kept
  // page-local since this page has no cart drawer of its own to share it
  // with.
  let paymentSdk: StripeCheckoutElementsSdk | null = null;
  let paymentMountedForOrderId: string | null = null;
  let paymentConfirming = false;
  let paymentErrorMessage: string | null = null;

  async function load(): Promise<void> {
    const session = getSession();
    if (!session) {
      root!.innerHTML = signedOutHtml();
      wireSignInLink(root!);
      return;
    }

    const thisRequest = ++requestId;
    root!.innerHTML = `<p class="orders-status">${t("orders-loading")}</p>`;

    try {
      orders = await fetchMyOrders();
      if (thisRequest !== requestId) return;
      // A stale selected order (e.g. it was cancelled from another tab) just
      // falls back to the list rather than erroring.
      if (selectedOrderId && !orders.some((o) => o.id === selectedOrderId)) {
        view = "list";
        selectedOrderId = null;
      }
      render();
    } catch (err) {
      if (thisRequest !== requestId) return;
      const message = err instanceof ApiError && err.status === 401 ? t("orders-signed-out") : t("orders-load-error");
      root!.innerHTML = `<p class="orders-status">${escapeHtml(message)}</p>`;
    }
  }

  function render(): void {
    clearExpiryTimer();
    if (view === "detail" && selectedOrderId) {
      const order = orders.find((o) => o.id === selectedOrderId);
      if (order) {
        root!.innerHTML = detailViewHtml(order);
        wireDetailEvents(order);
        armExpiryTimer(order);
        if (paymentMountedForOrderId === order.id) void mountResumePaymentElement();
        return;
      }
    }
    view = "list";
    root!.innerHTML = listViewHtml();
    wireListEvents();
  }

  // ── List view ──

  function listViewHtml(): string {
    const filtered = orders.filter((o) => filter === "all" || filterBucket(o.status) === filter);
    return `
      <div class="orders-filter-tabs" role="tablist">
        ${(["all", "active", "closed"] as Filter[])
          .map(
            (f) =>
              `<button type="button" class="orders-filter-tab${f === filter ? " is-active" : ""}" data-filter="${f}">${escapeHtml(
                t(`orders-filter-${f}`)
              )}</button>`
          )
          .join("")}
      </div>
      ${filtered.length === 0 ? `<p class="orders-status">${t("orders-empty")}</p>` : filtered.map(orderCardHtml).join("")}
    `;
  }

  function orderCardHtml(order: MyOrder): string {
    const itemsSummary = order.items.map((i) => `${escapeHtml(i.name)} × ${i.qty}`).join(", ");
    const date = new Date(order.createdAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    return `
      <button type="button" class="order-card order-card-clickable" data-order-id="${escapeAttr(order.id)}">
        <div class="order-card-header">
          <div>
            <div class="order-card-id">${t("orders-order-number")} ${escapeHtml(order.id.slice(0, 8).toUpperCase())}</div>
            <div class="order-card-date">${escapeHtml(date)}</div>
          </div>
          <span class="order-status-badge" data-status="${escapeAttr(customerStatusBucket(order.status))}">${escapeHtml(
      t(statusLabelKey(order.status))
    )}</span>
        </div>
        <p class="order-card-items">${itemsSummary}</p>
        <div class="order-card-total">${t("checkout-total")}: ${formatCents(order.totalCents)}</div>
      </button>
    `;
  }

  function wireListEvents(): void {
    root!.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        filter = btn.dataset.filter as Filter;
        render();
      });
    });
    root!.querySelectorAll<HTMLButtonElement>(".order-card-clickable").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedOrderId = btn.dataset.orderId!;
        view = "detail";
        actionErrorKey = null;
        confirmingCancelId = null;
        render();
      });
    });
  }

  // ── Detail view ──

  function detailViewHtml(order: MyOrder): string {
    const date = new Date(order.createdAt).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const bucket = customerStatusBucket(order.status);

    return `
      <button type="button" class="orders-back-link" data-action="back-to-list">${escapeHtml(t("orders-action-back-to-list"))}</button>
      <div class="order-detail">
        <div class="order-card-header">
          <div>
            <div class="order-card-id">${t("orders-order-number")} ${escapeHtml(order.id.slice(0, 8).toUpperCase())}</div>
            <div class="order-card-date">${escapeHtml(date)}</div>
          </div>
          <span class="order-status-badge" data-status="${escapeAttr(bucket)}">${escapeHtml(t(statusLabelKey(order.status)))}</span>
        </div>

        ${actionErrorKey ? `<div class="checkout-error">${escapeHtml(t(actionErrorKey))}</div>` : ""}

        ${statusActionBlockHtml(order)}

        <div class="order-detail-section">
          <ul class="order-card-items order-detail-items">
            ${order.items
              .map(
                (i) =>
                  `<li><span>${escapeHtml(i.name)} × ${i.qty}</span><span>${formatCents(i.unitPriceCents * i.qty)}</span></li>`
              )
              .join("")}
          </ul>
          <div class="cart-summary-row"><span>${t("cart-subtotal")}</span><span>${formatCents(order.subtotalCents)}</span></div>
          <div class="cart-summary-row"><span>${t("checkout-shipping-fee")}</span><span>${
      order.shippingFeeCents === 0 ? t("checkout-free") : formatCents(order.shippingFeeCents)
    }</span></div>
          <div class="cart-summary-row cart-total-row"><span>${t("checkout-total")}</span><span>${formatCents(order.totalCents)}</span></div>
          ${
            order.refundedCents > 0
              ? `<div class="cart-summary-row"><span>${t("orders-detail-refunded-amount")}</span><span>${formatCents(
                  order.refundedCents
                )}</span></div>`
              : ""
          }
        </div>

        <div class="order-detail-section order-detail-recipient">
          <div class="order-detail-label">${t("orders-detail-recipient")}</div>
          <p>${escapeHtml(order.recipient.name)} &middot; ${escapeHtml(order.recipient.phone)}</p>
          <div class="order-detail-label">${t("orders-detail-delivery-method")}</div>
          <p>${escapeHtml(t(order.deliveryMethod === "self_collection" ? "checkout-self-collection" : "checkout-standard-delivery"))}</p>
          ${
            order.deliveryMethod === "standard"
              ? `<div class="order-detail-label">${t("orders-detail-address")}</div>
                 <p>${escapeHtml(order.recipient.address)}, ${escapeHtml(order.recipient.postalCode)}</p>`
              : ""
          }
          <div class="order-detail-label">${t("orders-detail-payment-status")}</div>
          <p>${escapeHtml(t(paymentStatusLabelKey(order.status)))}</p>
        </div>

        <a class="btn-dark orders-whatsapp-btn" href="${escapeAttr(WHATSAPP_URL)}" target="_blank" rel="noopener">${escapeHtml(
      t("orders-action-contact-support")
    )}</a>
      </div>
    `;
  }

  // Renders the block of primary actions above the item list — its content
  // depends entirely on the order's current status bucket, per the target
  // status/action table this page was redesigned against.
  function statusActionBlockHtml(order: MyOrder): string {
    const bucket = customerStatusBucket(order.status);

    if (bucket === "pending_payment") {
      const expired = order.reservationExpiresAt != null && new Date(order.reservationExpiresAt).getTime() <= Date.now();
      if (expired) {
        return `
          <div class="order-detail-notice">
            <p>${escapeHtml(t("orders-payment-expired"))}</p>
            <button type="button" class="btn-gold" data-action="buy-again" ${actionBusy ? "disabled" : ""}>${escapeHtml(
          t("orders-action-buy-again")
        )}</button>
          </div>
        `;
      }
      if (paymentMountedForOrderId === order.id) {
        return `
          <div class="order-detail-notice">
            ${paymentErrorMessage ? `<div class="checkout-error">${escapeHtml(paymentErrorMessage)}</div>` : ""}
            <div id="orderPaymentElement" class="checkout-payment-element"></div>
            <button type="button" class="btn-gold" data-action="confirm-payment" ${paymentConfirming ? "disabled" : ""}>
              ${escapeHtml(paymentConfirming ? t("checkout-submitting") : t("checkout-pay-now"))}
            </button>
          </div>
        `;
      }
      if (confirmingCancelId === order.id) {
        return `
          <div class="order-detail-notice">
            <p>${escapeHtml(t("orders-action-cancel-confirm"))}</p>
            <div class="order-detail-actions">
              <button type="button" class="btn-gold" data-action="confirm-cancel" ${actionBusy ? "disabled" : ""}>${escapeHtml(
          t("orders-action-cancel-yes")
        )}</button>
              <button type="button" class="btn-dark" data-action="dismiss-cancel">${escapeHtml(t("orders-action-cancel-no"))}</button>
            </div>
          </div>
        `;
      }
      const payByTime = order.reservationExpiresAt
        ? new Date(order.reservationExpiresAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
        : null;
      return `
        <div class="order-detail-notice">
          ${payByTime ? `<p>${escapeHtml(t("orders-countdown-pay-by").replace("{time}", payByTime))}</p>` : ""}
          <div class="order-detail-actions">
            <button type="button" class="btn-gold" data-action="continue-payment" ${actionBusy ? "disabled" : ""}>${escapeHtml(
        t("orders-action-continue-payment")
      )}</button>
            <button type="button" class="btn-dark" data-action="cancel-order" ${actionBusy ? "disabled" : ""}>${escapeHtml(
        t("orders-action-cancel-order")
      )}</button>
          </div>
        </div>
      `;
    }

    if (bucket === "payment_review") {
      return `<div class="order-detail-notice"><p>${escapeHtml(t("orders-payment-review-note"))}</p></div>`;
    }

    if (bucket === "payment_failed") {
      return `
        <div class="order-detail-notice">
          <button type="button" class="btn-gold" data-action="buy-again" ${actionBusy ? "disabled" : ""}>${escapeHtml(
        t("orders-action-retry-checkout")
      )}</button>
        </div>
      `;
    }

    if (bucket === "cancelled" || bucket === "completed") {
      return `
        <div class="order-detail-notice">
          <button type="button" class="btn-gold" data-action="buy-again" ${actionBusy ? "disabled" : ""}>${escapeHtml(
        t("orders-action-buy-again")
      )}</button>
        </div>
      `;
    }

    // processing / shipped / refunded — nothing actionable beyond the detail
    // already shown below (and WhatsApp contact, always rendered).
    return "";
  }

  function wireDetailEvents(order: MyOrder): void {
    root!.querySelector('[data-action="back-to-list"]')?.addEventListener("click", () => {
      view = "list";
      selectedOrderId = null;
      paymentMountedForOrderId = null;
      paymentSdk = null;
      render();
    });
    root!.querySelector('[data-action="continue-payment"]')?.addEventListener("click", () => void handleContinuePayment(order));
    root!.querySelector('[data-action="cancel-order"]')?.addEventListener("click", () => {
      confirmingCancelId = order.id;
      render();
    });
    root!.querySelector('[data-action="dismiss-cancel"]')?.addEventListener("click", () => {
      confirmingCancelId = null;
      render();
    });
    root!.querySelector('[data-action="confirm-cancel"]')?.addEventListener("click", () => void handleCancelOrder(order));
    root!.querySelector('[data-action="buy-again"]')?.addEventListener("click", () => void handleBuyAgain(order));
    root!.querySelector('[data-action="confirm-payment"]')?.addEventListener("click", () => void handleConfirmResumePayment());
  }

  // Re-renders once the pending order's reservation actually lapses, so
  // "继续付款" flips to "支付已过期" / buy-again without the customer having
  // to manually refresh. Purely a client-side clock check against the
  // timestamp the server already returned — it never decides anything
  // itself, the cron + webhook pipeline (release-expired-reservations.ts)
  // is what actually releases stock server-side.
  function armExpiryTimer(order: MyOrder): void {
    if (customerStatusBucket(order.status) !== "pending_payment" || !order.reservationExpiresAt) return;
    if (paymentMountedForOrderId === order.id) return; // already mid-payment, nothing to countdown to
    const msRemaining = new Date(order.reservationExpiresAt).getTime() - Date.now();
    if (msRemaining <= 0) return; // already rendered as expired above
    expiryTimer = window.setTimeout(() => render(), Math.min(msRemaining + 1000, 2_147_483_647));
  }

  function clearExpiryTimer(): void {
    if (expiryTimer != null) {
      window.clearTimeout(expiryTimer);
      expiryTimer = null;
    }
  }

  async function handleContinuePayment(order: MyOrder): Promise<void> {
    actionBusy = true;
    actionErrorKey = null;
    render();
    try {
      const result = await resumeCheckoutSession(order.id);
      actionBusy = false;
      if (result.mode === "hosted") {
        window.location.href = result.checkoutUrl;
        return;
      }
      paymentMountedForOrderId = order.id;
      paymentErrorMessage = null;
      render();
    } catch (err) {
      actionBusy = false;
      if (err instanceof ApiError && err.code === "session_expired") {
        await load(); // refreshes status to expired/cancelled from the server
        return;
      }
      actionErrorKey = "orders-action-error";
      render();
    }
  }

  async function mountResumePaymentElement(): Promise<void> {
    if (paymentSdk) return; // already mounted for this order
    const stripe = await getStripeClient();
    if (!stripe) {
      paymentErrorMessage = t("checkout-error-generic");
      render();
      return;
    }
    // The clientSecret only lives in resumeCheckoutSession's response, not
    // on the order object — re-fetching here (rather than stashing it on
    // module state from handleContinuePayment) keeps a single source of
    // truth for "do we still have a live session" and re-validates it if
    // the customer navigated back to this view after it expired elsewhere.
    let clientSecret: string;
    try {
      const result = await resumeCheckoutSession(paymentMountedForOrderId!);
      if (result.mode !== "elements") {
        window.location.href = result.checkoutUrl;
        return;
      }
      clientSecret = result.clientSecret;
    } catch {
      paymentMountedForOrderId = null;
      await load();
      return;
    }

    paymentSdk = stripe.initCheckoutElementsSdk({
      clientSecret,
      elementsOptions: { appearance: paymentElementAppearance() },
    });
    const paymentElement = paymentSdk.createPaymentElement({ layout: { type: "accordion", radios: "always" } });
    if (document.getElementById("orderPaymentElement")) paymentElement.mount("#orderPaymentElement");
  }

  async function handleConfirmResumePayment(): Promise<void> {
    if (!paymentSdk || paymentConfirming) return;
    paymentConfirming = true;
    paymentErrorMessage = null;
    render();

    const loadResult = await paymentSdk.loadActions();
    if (loadResult.type === "error") {
      paymentConfirming = false;
      paymentErrorMessage = loadResult.error.message;
      render();
      return;
    }

    const result = await loadResult.actions.confirm({ redirect: "if_required" });
    paymentConfirming = false;

    if (result.type === "success") {
      paymentSdk = null;
      paymentMountedForOrderId = null;
      showToast(t("cart-order-success"));
      await load();
      return;
    }

    paymentErrorMessage = result.error.message;
    render();
  }

  async function handleCancelOrder(order: MyOrder): Promise<void> {
    actionBusy = true;
    render();
    try {
      await cancelMyOrder(order.id);
      confirmingCancelId = null;
      actionBusy = false;
      showToast(t("orders-action-cancelled-toast"));
      await load();
    } catch {
      actionBusy = false;
      actionErrorKey = "orders-action-error";
      render();
    }
  }

  // Re-adds this order's items to the cart at today's price/stock, then
  // hands off to index.html to actually show them — this page has no cart
  // drawer of its own. Deliberately never reuses the original order/session
  // (see src/cart.ts#maybeOpenCartFromQuery and the design note on why
  // "buy again" must never resume a concluded order).
  async function handleBuyAgain(order: MyOrder): Promise<void> {
    actionBusy = true;
    actionErrorKey = null;
    render();

    try {
      const skus = order.items.map((i) => i.sku);
      const [liveInfo, catalog] = await Promise.all([fetchLivePrices(skus), fetchProductCatalog()]);
      const liveBySku = new Map(liveInfo.map((p) => [p.sku, p]));
      const catalogBySku = new Map(catalog.map((p) => [p.sku, p]));

      const cartStore = new CartStore();
      let addedCount = 0;
      for (const item of order.items) {
        const live = liveBySku.get(item.sku);
        const product = catalogBySku.get(item.sku);
        if (!live || !product || !live.isActive || live.availableStock <= 0 || !product.prices?.bottle) continue;
        cartStore.addItem(
          {
            sku: item.sku,
            name: product.nameEn || product.name,
            image: product.image,
            priceTiers: {
              bottlePriceCents: live.unitPriceCents,
              caseSize: product.prices.caseSize,
              casePriceCents: product.prices.case != null ? Math.round(product.prices.case * 100) : null,
              fiveCaseSize: product.prices.fiveCaseSize,
              fiveCasePriceCents: product.prices.fiveCases != null ? Math.round(product.prices.fiveCases * 100) : null,
            },
          },
          Math.min(item.qty, live.availableStock)
        );
        addedCount++;
      }

      actionBusy = false;
      if (addedCount === 0) {
        actionErrorKey = "orders-action-buy-again-none";
        render();
        return;
      }
      window.location.href = "/?openCart=1";
    } catch {
      actionBusy = false;
      actionErrorKey = "orders-action-error";
      render();
    }
  }

  function wireSignInLink(el: HTMLElement): void {
    el.querySelector("#ordersSignInLink")?.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = "/?signin=1";
    });
  }

  void initAuth().then(load);
  // Skips re-rendering while a Payment Element is actively mounted (the
  // "继续付款" flow) — same reasoning as src/cart.ts's onAuthChange/
  // onLangChange guards around checkoutStage "payment": a spurious auth
  // event (e.g. Supabase's INITIAL_SESSION firing after the page's own
  // initAuth() already resolved) or a language toggle would otherwise blow
  // away the live Stripe iframe mid-payment by replacing root.innerHTML.
  onAuthChange(() => {
    if (paymentMountedForOrderId == null) void load();
  });
  onLangChange(() => {
    if (paymentMountedForOrderId == null) render();
  });
}

async function fetchProductCatalog(): Promise<ProductSummary[]> {
  const res = await fetch("/products.json");
  if (!res.ok) return [];
  const data = (await res.json()) as { products: ProductSummary[] };
  return data.products ?? [];
}

function signedOutHtml(): string {
  return `
    <p class="orders-status">${t("orders-signed-out")}</p>
    <a href="#" class="btn-gold orders-signin-btn" id="ordersSignInLink">${t("nav-sign-in")}</a>
  `;
}

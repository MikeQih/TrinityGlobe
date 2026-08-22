import { ApiError, fetchMyOrders } from "./api-client";
import { getSession, initAuth, onAuthChange } from "./auth";
import { escapeAttr, escapeHtml } from "./html-escape";
import { formatCents, onLangChange, t } from "./i18n";
import type { MyOrder } from "./types";

// Renders orders.html's order list — a no-op everywhere else (guarded by
// #myOrdersRoot, same pattern as initCart()'s #cartRoot check). Self-
// contained like initAccountNav(): calls initAuth() itself rather than
// assuming initCart() already ran, since this page has no cart drawer.
export function initOrdersPage(): void {
  const root = document.getElementById("myOrdersRoot");
  if (!root) return;

  let requestId = 0;

  async function render(): Promise<void> {
    const session = getSession();
    if (!session) {
      root!.innerHTML = signedOutHtml();
      wireSignInLink(root!);
      return;
    }

    // Guards against an in-flight fetch from a stale render (e.g. a rapid
    // sign-in followed by a language toggle) overwriting a newer one.
    const thisRequest = ++requestId;
    root!.innerHTML = `<p class="orders-status">${t("orders-loading")}</p>`;

    try {
      const orders = await fetchMyOrders();
      if (thisRequest !== requestId) return;
      root!.innerHTML = orders.length === 0 ? emptyHtml() : orders.map(orderCardHtml).join("");
    } catch (err) {
      if (thisRequest !== requestId) return;
      const message = err instanceof ApiError && err.status === 401 ? t("orders-signed-out") : t("orders-load-error");
      root!.innerHTML = `<p class="orders-status">${escapeHtml(message)}</p>`;
    }
  }

  void initAuth().then(render);
  onAuthChange(render);
  onLangChange(render);
}

function signedOutHtml(): string {
  return `
    <p class="orders-status">${t("orders-signed-out")}</p>
    <a href="#" class="btn-gold orders-signin-btn" id="ordersSignInLink">${t("nav-sign-in")}</a>
  `;
}

function wireSignInLink(root: HTMLElement): void {
  root.querySelector("#ordersSignInLink")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "/?signin=1";
  });
}

function emptyHtml(): string {
  return `<p class="orders-status">${t("orders-empty")}</p>`;
}

function orderCardHtml(order: MyOrder): string {
  const itemsHtml = order.items.map((i) => `<li>${escapeHtml(i.name)} × ${i.qty}</li>`).join("");
  const date = new Date(order.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return `
    <div class="order-card">
      <div class="order-card-header">
        <div>
          <div class="order-card-id">${t("orders-order-number")} ${escapeHtml(order.id.slice(0, 8).toUpperCase())}</div>
          <div class="order-card-date">${escapeHtml(date)}</div>
        </div>
        <span class="order-status-badge" data-status="${escapeAttr(order.status)}">${escapeHtml(
    t(`order-status-${order.status}`)
  )}</span>
      </div>
      <ul class="order-card-items">${itemsHtml}</ul>
      <div class="order-card-total">${t("checkout-total")}: ${formatCents(order.totalCents)}</div>
    </div>
  `;
}

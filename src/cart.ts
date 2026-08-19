import { CartStore, MAX_QTY_PER_ITEM } from "./cart-store";
import { createCheckoutSession, ApiError } from "./api-client";
import { t, onLangChange, getProductBySku, formatCents } from "./i18n";
import { computeShippingFeeCents, computeRemainingForFreeShippingCents } from "./pricing";
import type { CartItem, CheckoutRecipient, DeliveryMethod } from "./types";

// Mirrors the store_settings defaults seeded in supabase/migrations/0001_init.sql.
// This is a display-only estimate for the drawer — create-checkout-session
// is authoritative and reads the live values from the database, so the
// customer's charge can never drift from what an out-of-date bundle shows.
const FREE_SHIPPING_THRESHOLD_CENTS = 12000;
const STANDARD_SHIPPING_FEE_CENTS = 1500;

const store = new CartStore();

type View = "cart" | "checkout";
let view: View = "cart";
let isOpen = false;
let isSubmitting = false;
// Translation *keys*, not translated text — translated at render time so an
// error surfaced before a language toggle still reads correctly after it.
let submitErrorKey: string | null = null;
let fieldErrorKeys: Partial<Record<keyof CheckoutRecipient, string>> = {};

let recipient: CheckoutRecipient = {
  name: "",
  phone: "",
  email: "",
  address: "",
  postalCode: "",
  notes: "",
};
let deliveryMethod: DeliveryMethod = "standard";
let ageConfirmed = false;

let overlayEl: HTMLDivElement;
let drawerEl: HTMLDivElement;

export function initCart(): void {
  const root = document.getElementById("cartRoot");
  if (!root) return;

  overlayEl = document.createElement("div");
  overlayEl.className = "cart-overlay";
  overlayEl.addEventListener("click", closeDrawer);

  drawerEl = document.createElement("div");
  drawerEl.className = "cart-drawer";
  drawerEl.setAttribute("role", "dialog");
  drawerEl.setAttribute("aria-modal", "true");
  drawerEl.setAttribute("aria-label", "Cart");

  root.appendChild(overlayEl);
  root.appendChild(drawerEl);

  document.getElementById("cartToggle")?.addEventListener("click", openDrawer);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) closeDrawer();
  });

  // Delegated: "Add to Cart" buttons are rendered by script.js's
  // renderProducts() into #productGrid, possibly after this listener is
  // attached, and re-rendered on every language toggle — delegation on the
  // stable container means we never have to re-wire per-card listeners.
  document.getElementById("productGrid")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".add-cart-btn");
    if (btn) handleAddToCart(btn);
  });

  store.subscribe(() => {
    renderBadge();
    if (isOpen && view === "cart") renderDrawer();
  });

  onLangChange(() => {
    renderBadge();
    if (isOpen) renderDrawer();
  });

  renderBadge();
}

function handleAddToCart(btn: HTMLButtonElement): void {
  const sku = btn.dataset.sku;
  if (!sku) return;
  const product = getProductBySku(sku);
  const bottlePrice = product?.prices?.bottle;
  if (!product || bottlePrice == null || bottlePrice <= 0) return;

  const item: Omit<CartItem, "qty"> = {
    sku,
    name: product.nameEn || product.name,
    image: product.image,
    unitPriceCents: Math.round(bottlePrice * 100),
  };
  store.addItem(item);

  const original = btn.textContent;
  btn.classList.add("is-added");
  btn.textContent = t("cart-added");
  window.setTimeout(() => {
    btn.classList.remove("is-added");
    btn.textContent = original ?? t("cart-add-btn");
  }, 1200);
}

function renderBadge(): void {
  const countEl = document.getElementById("cartCount");
  if (!countEl) return;
  const count = store.getItemCount();
  countEl.textContent = String(count);
  countEl.hidden = count === 0;
}

function openDrawer(): void {
  isOpen = true;
  if (store.getItems().length === 0) view = "cart";
  document.getElementById("cartToggle")?.setAttribute("aria-expanded", "true");
  overlayEl.classList.add("open");
  drawerEl.classList.add("open");
  renderDrawer();
}

function closeDrawer(): void {
  isOpen = false;
  document.getElementById("cartToggle")?.setAttribute("aria-expanded", "false");
  overlayEl.classList.remove("open");
  drawerEl.classList.remove("open");
}

function goToCheckout(): void {
  if (store.getItems().length === 0) return;
  view = "checkout";
  submitErrorKey = null;
  fieldErrorKeys = {};
  renderDrawer();
}

function backToCart(): void {
  view = "cart";
  renderDrawer();
}

function renderDrawer(): void {
  drawerEl.innerHTML = view === "cart" ? cartViewHtml() : checkoutViewHtml();
  wireDrawerEvents();
}

// ── Cart view ──

function cartViewHtml(): string {
  const items = store.getItems();
  const subtotal = store.getSubtotalCents();
  const remaining = computeRemainingForFreeShippingCents(subtotal, FREE_SHIPPING_THRESHOLD_CENTS);

  const itemsHtml =
    items.length === 0 ? `<p class="cart-empty">${t("cart-empty")}</p>` : items.map(itemRowHtml).join("");

  const shippingHint =
    items.length === 0
      ? ""
      : remaining === 0
      ? `<p class="cart-shipping-hint is-met">${t("cart-free-shipping-met")}</p>`
      : `<p class="cart-shipping-hint">${t("cart-free-shipping-hint").replace("{amount}", formatCents(remaining))}</p>`;

  return `
    <div class="cart-drawer-header">
      <h2>${t("cart-title")}</h2>
      <button type="button" class="cart-drawer-close" data-action="close" aria-label="${t("cart-close")}">&times;</button>
    </div>
    <div class="cart-drawer-body">${itemsHtml}</div>
    <div class="cart-drawer-footer">
      ${shippingHint}
      <div class="cart-summary-row"><span>${t("cart-subtotal")}</span><span>${formatCents(subtotal)}</span></div>
      <button type="button" class="btn-gold" data-action="checkout" ${items.length === 0 ? "disabled" : ""}>
        ${t("cart-checkout-btn")}
      </button>
    </div>
  `;
}

function itemRowHtml(item: CartItem): string {
  return `
    <div class="cart-item" data-sku="${escapeAttr(item.sku)}">
      <div class="cart-item-img"><img src="${escapeAttr(item.image)}" alt="" loading="lazy" /></div>
      <div>
        <div class="cart-item-name">${escapeHtml(item.name)}</div>
        <div class="cart-item-price">${formatCents(item.unitPriceCents)}</div>
        <div class="cart-item-qty">
          <button type="button" class="cart-qty-btn" data-action="qty-dec" aria-label="${t("cart-qty-decrease")}">&minus;</button>
          <span class="cart-item-qty-value">${item.qty}</span>
          <button type="button" class="cart-qty-btn" data-action="qty-inc" aria-label="${t("cart-qty-increase")}" ${
    item.qty >= MAX_QTY_PER_ITEM ? "disabled" : ""
  }>+</button>
        </div>
      </div>
      <button type="button" class="cart-item-remove" data-action="remove">${t("cart-remove")}</button>
    </div>
  `;
}

// ── Checkout view ──

function checkoutViewHtml(): string {
  const err = (key: keyof CheckoutRecipient) =>
    fieldErrorKeys[key] ? `<p class="checkout-field-error">${escapeHtml(t(fieldErrorKeys[key] as string))}</p>` : "";
  const cls = (key: keyof CheckoutRecipient) => (fieldErrorKeys[key] ? "checkout-field has-error" : "checkout-field");

  return `
    <div class="cart-drawer-header">
      <button type="button" class="cart-drawer-back" data-action="back">${t("checkout-back-to-cart")}</button>
      <h2>${t("checkout-title")}</h2>
      <button type="button" class="cart-drawer-close" data-action="close" aria-label="${t("cart-close")}">&times;</button>
    </div>
    <div class="cart-drawer-body">
      ${submitErrorKey ? `<div class="checkout-error">${escapeHtml(t(submitErrorKey))}</div>` : ""}
      <form id="checkoutForm" novalidate>
        <div class="${cls("name")}">
          <label for="ck-name">${t("checkout-name")}</label>
          <input id="ck-name" name="name" type="text" value="${escapeAttr(recipient.name)}" autocomplete="name" />
          ${err("name")}
        </div>
        <div class="${cls("phone")}">
          <label for="ck-phone">${t("checkout-phone")}</label>
          <input id="ck-phone" name="phone" type="tel" value="${escapeAttr(recipient.phone)}" autocomplete="tel" />
          ${err("phone")}
        </div>
        <div class="${cls("email")}">
          <label for="ck-email">${t("checkout-email")}</label>
          <input id="ck-email" name="email" type="email" value="${escapeAttr(recipient.email)}" autocomplete="email" />
          ${err("email")}
        </div>

        <div class="checkout-delivery-options">
          <label class="checkout-radio">
            <input type="radio" name="deliveryMethod" value="standard" ${deliveryMethod === "standard" ? "checked" : ""} />
            ${t("checkout-standard-delivery")}
          </label>
          <label class="checkout-radio">
            <input type="radio" name="deliveryMethod" value="self_collection" ${
              deliveryMethod === "self_collection" ? "checked" : ""
            } />
            ${t("checkout-self-collection")}
          </label>
        </div>

        <div id="ck-address-group" ${deliveryMethod === "self_collection" ? "hidden" : ""}>
          <div class="${cls("address")}">
            <label for="ck-address">${t("checkout-address")}</label>
            <input id="ck-address" name="address" type="text" value="${escapeAttr(recipient.address)}" autocomplete="street-address" />
            ${err("address")}
          </div>
          <div class="${cls("postalCode")}">
            <label for="ck-postal">${t("checkout-postal")}</label>
            <input id="ck-postal" name="postalCode" type="text" value="${escapeAttr(recipient.postalCode)}" autocomplete="postal-code" />
            ${err("postalCode")}
          </div>
        </div>

        <div class="checkout-field">
          <label for="ck-notes">${t("checkout-notes")}</label>
          <textarea id="ck-notes" name="notes">${escapeHtml(recipient.notes)}</textarea>
        </div>

        <label class="checkout-age-confirm">
          <input type="checkbox" name="ageConfirmed" ${ageConfirmed ? "checked" : ""} />
          <span>${t("checkout-age-confirm")} <a href="/policies/age-restriction.html" target="_blank" rel="noopener">${t("checkout-age-learn-more")}</a></span>
        </label>
      </form>
    </div>
    ${checkoutFooterHtml()}
  `;
}

function checkoutFooterHtml(): string {
  const subtotal = store.getSubtotalCents();
  const shippingFee = computeShippingFeeCents({
    subtotalCents: subtotal,
    freeShippingThresholdCents: FREE_SHIPPING_THRESHOLD_CENTS,
    standardShippingFeeCents: STANDARD_SHIPPING_FEE_CENTS,
    deliveryMethod,
  });
  const total = subtotal + shippingFee;

  return `
    <div class="cart-drawer-footer">
      <div class="checkout-summary">
        <div class="cart-summary-row"><span>${t("cart-subtotal")}</span><span>${formatCents(subtotal)}</span></div>
        <div class="cart-summary-row"><span>${t("checkout-shipping-fee")}</span><span>${
    shippingFee === 0 ? t("checkout-free") : formatCents(shippingFee)
  }</span></div>
        <div class="cart-summary-row cart-total-row"><span>${t("checkout-total")}</span><span>${formatCents(total)}</span></div>
      </div>
      <button type="submit" form="checkoutForm" class="btn-gold" ${isSubmitting ? "disabled" : ""}>
        ${isSubmitting ? t("checkout-submitting") : t("checkout-submit")}
      </button>
    </div>
  `;
}

function updateCheckoutFooter(): void {
  const footer = drawerEl.querySelector(".cart-drawer-footer");
  if (footer) footer.outerHTML = checkoutFooterHtml();
}

// ── Event wiring (re-attached after every drawerEl.innerHTML replace) ──

function wireDrawerEvents(): void {
  drawerEl.querySelectorAll<HTMLElement>("[data-action]").forEach((el) => {
    el.addEventListener("click", (e) => {
      const action = (e.currentTarget as HTMLElement).dataset.action;
      const itemEl = (e.currentTarget as HTMLElement).closest<HTMLElement>(".cart-item");
      const sku = itemEl?.dataset.sku;
      const current = () => store.getItems().find((i) => i.sku === sku);

      switch (action) {
        case "close":
          closeDrawer();
          break;
        case "checkout":
          goToCheckout();
          break;
        case "back":
          backToCart();
          break;
        case "qty-inc": {
          const item = current();
          if (item) store.updateQty(item.sku, item.qty + 1);
          break;
        }
        case "qty-dec": {
          const item = current();
          if (item) store.updateQty(item.sku, item.qty - 1);
          break;
        }
        case "remove":
          if (sku) store.removeItem(sku);
          break;
      }
    });
  });

  if (view === "checkout") wireCheckoutForm();
}

function wireCheckoutForm(): void {
  const form = document.getElementById("checkoutForm") as HTMLFormElement | null;
  if (!form) return;

  form.addEventListener("input", (e) => {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    if (isRecipientField(target.name)) {
      recipient[target.name] = target.value;
    }
  });

  form.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement;
    if (target.name === "deliveryMethod") {
      deliveryMethod = target.value as DeliveryMethod;
      const addressGroup = document.getElementById("ck-address-group");
      if (addressGroup) addressGroup.hidden = deliveryMethod === "self_collection";
      updateCheckoutFooter();
    } else if (target.name === "ageConfirmed") {
      ageConfirmed = target.checked;
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void handleCheckoutSubmit();
  });
}

function isRecipientField(name: string): name is keyof CheckoutRecipient {
  return name === "name" || name === "phone" || name === "email" || name === "address" || name === "postalCode" || name === "notes";
}

async function handleCheckoutSubmit(): Promise<void> {
  fieldErrorKeys = validateRecipient(recipient, deliveryMethod);

  if (!ageConfirmed) {
    submitErrorKey = "checkout-age-required";
    renderDrawer();
    return;
  }

  if (Object.keys(fieldErrorKeys).length > 0) {
    submitErrorKey = null;
    renderDrawer();
    return;
  }

  isSubmitting = true;
  submitErrorKey = null;
  renderDrawer();

  try {
    const { checkoutUrl } = await createCheckoutSession({
      items: store.getItems().map((i) => ({ sku: i.sku, qty: i.qty })),
      deliveryMethod,
      recipient,
      ageConfirmed,
    });
    window.location.href = checkoutUrl;
  } catch (error) {
    isSubmitting = false;
    submitErrorKey =
      error instanceof ApiError && error.code === "insufficient_stock" ? "checkout-error-stock" : "checkout-error-generic";
    renderDrawer();
  }
}

function validateRecipient(
  r: CheckoutRecipient,
  method: DeliveryMethod
): Partial<Record<keyof CheckoutRecipient, string>> {
  const errors: Partial<Record<keyof CheckoutRecipient, string>> = {};
  const requiredKey = "checkout-field-required";
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!r.name.trim()) errors.name = requiredKey;
  if (!r.phone.trim()) errors.phone = requiredKey;
  if (!r.email.trim() || !emailPattern.test(r.email)) errors.email = requiredKey;
  if (method === "standard") {
    if (!r.address.trim()) errors.address = requiredKey;
    if (!r.postalCode.trim()) errors.postalCode = requiredKey;
  }
  return errors;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

import { CartStore, MAX_QTY_PER_ITEM } from "./cart-store";
import { createCheckoutSession, ApiError } from "./api-client";
import { t, onLangChange, getProductBySku, formatCents } from "./i18n";
import { computeShippingFeeCents, computeRemainingForFreeShippingCents, effectiveUnitPriceCents } from "./pricing";
import {
  getSession,
  initAuth,
  isAuthAvailable,
  onAuthChange,
  resendSignupOtp,
  saveCustomerProfile,
  signInWithFacebook,
  signInWithGoogle,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  verifySignupOtp,
} from "./auth";
import { escapeAttr, escapeHtml } from "./html-escape";
import type { CartItem, CartItemPriceTiers, CheckoutRecipient, DeliveryMethod, Gender, SignupProfile } from "./types";

type PriceTier = "bottle" | "case" | "fiveCase";

// Mirrors the store_settings defaults seeded in supabase/migrations/0001_init.sql.
// This is a display-only estimate for the drawer — create-checkout-session
// is authoritative and reads the live values from the database, so the
// customer's charge can never drift from what an out-of-date bundle shows.
const FREE_SHIPPING_THRESHOLD_CENTS = 12000;
const STANDARD_SHIPPING_FEE_CENTS = 1500;

const store = new CartStore();

// Reused across page loads to reopen the checkout drawer after the Google
// OAuth round trip navigates away and back to this same origin — a full
// page navigation loses all the in-memory state below (view, checkoutStage,
// etc.), so localStorage is the only thing that survives it.
const REOPEN_CHECKOUT_STORAGE_KEY = "tg_reopen_checkout";

type View = "cart" | "checkout";
// "account": paneco-style guest/Google/Facebook/email choice shown before the
// checkout form the first time a signed-out visitor reaches checkout this
// page load.
// "email-auth": the paneco-style Sign Up / Sign In forms, reached via
// "account"'s "Continue with Email" button.
// "email-otp": 8-digit code entry after a successful signup — the signup
// itself doesn't create a usable session until this succeeds (Confirm Email
// is on for this project).
// "form": the actual recipient/delivery form (was previously the only stage).
type CheckoutStage = "account" | "email-auth" | "email-otp" | "form";
let view: View = "cart";
let checkoutStage: CheckoutStage = "account";
let accountChoiceMade = false;
let isOpen = false;
let isSubmitting = false;
// Translation *keys*, not translated text — translated at render time so an
// error surfaced before a language toggle still reads correctly after it.
let submitErrorKey: string | null = null;
let fieldErrorKeys: Partial<Record<keyof CheckoutRecipient, string>> = {};

// ── Email/password signup + sign-in (checkoutStage "email-auth"/"email-otp") ──

interface SignupFormState {
  firstName: string;
  lastName: string;
  gender: Gender | "";
  dateOfBirth: string;
  email: string;
  password: string;
  passwordConfirm: string;
  newsletterSubscribed: boolean;
}

let emailAuthTab: "signup" | "signin" = "signup";
let signupForm: SignupFormState = {
  firstName: "",
  lastName: "",
  gender: "",
  dateOfBirth: "",
  email: "",
  password: "",
  passwordConfirm: "",
  newsletterSubscribed: false,
};
let signupFieldErrorKeys: Partial<Record<keyof SignupFormState, string>> = {};
let signupErrorKey: string | null = null;
let signupSubmitting = false;

let signinForm = { email: "", password: "" };
let signinFieldErrorKeys: Partial<Record<"email" | "password", string>> = {};
let signinErrorKey: string | null = null;
let signinSubmitting = false;

// Stashed between a successful signUpWithPassword() and a successful
// verifySignupOtp() — customer_profiles can only be written once there's an
// authenticated user to attach it to (see auth.ts#saveCustomerProfile).
let pendingSignupProfile: SignupProfile | null = null;
let otpEmail = "";
let otpCode = "";
let otpErrorKey: string | null = null;
let otpSubmitting = false;

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
  handleCheckoutRedirect();
  void bootAuth();
}

async function bootAuth(): Promise<void> {
  await initAuth();
  onAuthChange(() => {
    // A session change while the drawer happens to be open (e.g. the sign-out
    // button, or a stray auth event) should be reflected immediately rather
    // than on the next unrelated re-render.
    if (isOpen && view === "checkout") renderDrawer();
  });
  maybeReopenCheckoutAfterAuth();
  maybeOpenSignInFromQuery();
}

// Companion to the nav's "Sign In" entry on pages without a cart drawer of
// their own (orders.html) — it redirects here with ?signin=1 instead of
// trying to render the auth UI a second time.
function maybeOpenSignInFromQuery(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get("signin") !== "1") return;
  params.delete("signin");
  const query = params.toString();
  const newUrl = window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
  window.history.replaceState(null, "", newUrl);
  if (getSession()) return;
  openAccountDrawer();
}

// Opens the drawer straight to the sign-in/sign-up screen, independent of
// checkout — used by the nav's "Sign In" entry, which has nothing to do
// with what's in the cart. Bypasses goToCheckout()'s "cart must have items"
// guard and its "ask once" accountChoiceMade shortcut on purpose, since this
// is an explicit "I want to sign in" action, not a checkout attempt.
export function openAccountDrawer(): void {
  if (getSession()) return;
  view = "checkout";
  checkoutStage = "account";
  isOpen = true;
  document.getElementById("cartToggle")?.setAttribute("aria-expanded", "true");
  overlayEl.classList.add("open");
  drawerEl.classList.add("open");
  renderDrawer();
}

// ── Nav account indicator (index.html's #navAccount, orders.html's too) ──
// Self-contained: initAuth() is idempotent, so this works whether or not
// initCart() already called it on this page.
export function initAccountNav(): void {
  const container = document.getElementById("navAccount");
  if (!container) return;
  const hasDrawer = document.getElementById("cartRoot") != null;

  const render = (): void => {
    const session = getSession();
    container.innerHTML = session
      ? `<a href="/orders.html" class="nav-account-link">${escapeHtml(t("nav-my-orders"))}</a>
         <button type="button" class="nav-account-signout" data-nav-account-action="signout">${escapeHtml(
           t("nav-sign-out")
         )}</button>`
      : `<a href="#" class="nav-account-signin" data-nav-account-action="signin">${escapeHtml(t("nav-sign-in"))}</a>`;

    container.querySelectorAll<HTMLElement>("[data-nav-account-action]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const action = el.dataset.navAccountAction;
        if (action === "signin") {
          if (hasDrawer) openAccountDrawer();
          else window.location.href = "/?signin=1";
        } else if (action === "signout") {
          void signOut();
        }
      });
    });
  };

  void initAuth().then(render);
  onAuthChange(render);
  onLangChange(render);
}

// After signInWithGoogle() redirects away and Google sends the browser back,
// this picks the flow back up right where the user left it instead of
// dropping them on a bare homepage with a full cart and no explanation.
function maybeReopenCheckoutAfterAuth(): void {
  const flag = window.localStorage.getItem(REOPEN_CHECKOUT_STORAGE_KEY);
  if (!flag) return;
  window.localStorage.removeItem(REOPEN_CHECKOUT_STORAGE_KEY);
  if (store.getItems().length === 0) return;
  openDrawer();
  goToCheckout();
}

// Stripe redirects back to `${SITE_URL}/?checkout=success|cancelled&order_id=...`
// (see create-checkout-session.ts's success_url/cancel_url). A successful
// payment means the reservation this cart represents was already confirmed
// server-side, so the local cart is stale and must be cleared — otherwise
// the customer sees the same items sitting in their cart right after paying
// for them. A cancelled/abandoned checkout leaves the cart untouched so they
// can resume it.
function handleCheckoutRedirect(): void {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("checkout");
  if (status !== "success" && status !== "cancelled") return;

  if (status === "success") {
    store.clear();
    showToast(t("cart-order-success"));
  } else {
    showToast(t("cart-order-cancelled"));
  }

  params.delete("checkout");
  params.delete("order_id");
  const query = params.toString();
  const newUrl = window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
  window.history.replaceState(null, "", newUrl);
}

function showToast(message: string): void {
  const toast = document.createElement("div");
  toast.className = "cart-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.requestAnimationFrame(() => toast.classList.add("is-visible"));
  window.setTimeout(() => {
    toast.classList.remove("is-visible");
    window.setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/** null when the product isn't found or has no bottle price — same "can't sell this" guard used everywhere a SKU is resolved against the live catalog. */
function buildPriceTiers(sku: string): CartItemPriceTiers | null {
  const product = getProductBySku(sku);
  const prices = product?.prices;
  const bottlePrice = prices?.bottle;
  if (bottlePrice == null || bottlePrice <= 0) return null;
  return {
    bottlePriceCents: Math.round(bottlePrice * 100),
    caseSize: prices?.caseSize ?? null,
    casePriceCents: prices?.case != null ? Math.round(prices.case * 100) : null,
    fiveCaseSize: prices?.fiveCaseSize ?? null,
    fiveCasePriceCents: prices?.fiveCases != null ? Math.round(prices.fiveCases * 100) : null,
  };
}

// A cart persists in localStorage across page loads, but each item's
// priceTiers is a snapshot taken when it was added — if pricing/case-size
// data changes afterwards (e.g. we fill in a case size the day after a
// customer added a bottle), their already-in-cart item would otherwise keep
// quoting the stale tier forever. Called once the catalog is guaranteed to
// be loaded — i.e. right as the drawer opens (see openDrawer) — rather than
// on every render, since it's a reconciliation pass, not a per-render cost.
function reconcilePriceTiers(): void {
  for (const item of store.getItems()) {
    const fresh = buildPriceTiers(item.sku);
    if (fresh) store.updatePriceTiers(item.sku, fresh);
  }
}

function handleAddToCart(btn: HTMLButtonElement): void {
  const sku = btn.dataset.sku;
  if (!sku) return;
  const priceTiers = buildPriceTiers(sku);
  const product = getProductBySku(sku);
  if (!product || !priceTiers) return;

  const tier = (btn.dataset.tier as PriceTier | undefined) ?? "bottle";

  // The button is only ever rendered (see script.js#buildPriceGrid) for a
  // case/five-case tier once its size is known, but guard here too in case
  // a stale bundle renders a card from before that size was added.
  const addQty =
    tier === "case" ? priceTiers.caseSize : tier === "fiveCase" ? priceTiers.fiveCaseSize : 1;
  if (!addQty) return;

  const item: Omit<CartItem, "qty"> = {
    sku,
    name: product.nameEn || product.name,
    image: product.image,
    priceTiers,
  };
  store.addItem(item, addQty);

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
  reconcilePriceTiers();
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
  const session = getSession();
  // No account system configured, already signed in, or already chose guest
  // earlier this page load — any of those skip straight past the choice
  // screen to the form, matching paneco's "ask once" behaviour.
  checkoutStage = !isAuthAvailable() || session || accountChoiceMade ? "form" : "account";
  if (session?.user.email && !recipient.email) recipient.email = session.user.email;
  renderDrawer();
}

function backToCart(): void {
  view = "cart";
  renderDrawer();
}

function renderDrawer(): void {
  drawerEl.innerHTML =
    view === "cart"
      ? cartViewHtml()
      : checkoutStage === "account"
      ? accountChoiceHtml()
      : checkoutStage === "email-auth"
      ? emailAuthHtml()
      : checkoutStage === "email-otp"
      ? otpHtml()
      : checkoutViewHtml();
  wireDrawerEvents();
}

// "back" means something different depending on how deep into the account
// flow the drawer is — cart.ts's other back-button usages (account stage,
// checkout form) still mean "back to cart" and keep using
// checkout-back-to-cart directly.
function handleBack(): void {
  if (checkoutStage === "email-auth") {
    checkoutStage = "account";
    renderDrawer();
  } else if (checkoutStage === "email-otp") {
    checkoutStage = "email-auth";
    renderDrawer();
  } else {
    backToCart();
  }
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
  const unitPriceCents = effectiveUnitPriceCents(item.qty, item.priceTiers);
  const tierBadge =
    item.priceTiers.fiveCasePriceCents != null && unitPriceCents === item.priceTiers.fiveCasePriceCents
      ? `<span class="cart-item-tier">${t("cart-tier-five-case")}</span>`
      : item.priceTiers.casePriceCents != null && unitPriceCents === item.priceTiers.casePriceCents
      ? `<span class="cart-item-tier">${t("cart-tier-case")}</span>`
      : "";

  return `
    <div class="cart-item" data-sku="${escapeAttr(item.sku)}">
      <div class="cart-item-img"><img src="${escapeAttr(item.image)}" alt="" loading="lazy" /></div>
      <div>
        <div class="cart-item-name">${escapeHtml(item.name)}</div>
        <div class="cart-item-price">${formatCents(unitPriceCents)} ${tierBadge}</div>
        <div class="cart-item-qty">
          <button type="button" class="cart-qty-btn" data-action="qty-dec" aria-label="${t("cart-qty-decrease")}">&minus;</button>
          <input
            type="number"
            class="cart-item-qty-input"
            value="${item.qty}"
            min="1"
            max="${MAX_QTY_PER_ITEM}"
            step="1"
            inputmode="numeric"
            aria-label="${t("cart-qty-label")}"
          />
          <button type="button" class="cart-qty-btn" data-action="qty-inc" aria-label="${t("cart-qty-increase")}" ${
    item.qty >= MAX_QTY_PER_ITEM ? "disabled" : ""
  }>+</button>
        </div>
      </div>
      <button type="button" class="cart-item-remove" data-action="remove">${t("cart-remove")}</button>
    </div>
  `;
}

// ── Account choice (guest vs Google) ──

// Shown once per page load, before the checkout form, only when a signed-out
// visitor with Google sign-in configured reaches checkout — mirrors paneco's
// "Continue as Guest" / "Create account" screen rather than forcing login.
function accountChoiceHtml(): string {
  return `
    <div class="cart-drawer-header">
      <button type="button" class="cart-drawer-back" data-action="back">${t("checkout-back-to-cart")}</button>
      <h2>${t("checkout-title")}</h2>
      <button type="button" class="cart-drawer-close" data-action="close" aria-label="${t("cart-close")}">&times;</button>
    </div>
    <div class="cart-drawer-body">
      <div class="checkout-account-choice">
        <p class="checkout-account-lead">${t("checkout-account-lead")}</p>
        <button type="button" class="btn-dark checkout-google-btn" data-action="signin-google">${t(
          "checkout-signin-google"
        )}</button>
        <button type="button" class="btn-dark checkout-facebook-btn" data-action="signin-facebook">${t(
          "checkout-signin-facebook"
        )}</button>
        <button type="button" class="btn-dark checkout-email-btn" data-action="use-email">${t(
          "checkout-use-email"
        )}</button>
        <button type="button" class="btn-gold" data-action="continue-guest">${t("checkout-continue-guest")}</button>
      </div>
    </div>
  `;
}

// ── Email/password sign up + sign in ──

function emailAuthHtml(): string {
  const tabs = `
    <div class="checkout-auth-tabs">
      <button type="button" class="checkout-auth-tab ${
        emailAuthTab === "signup" ? "is-active" : ""
      }" data-action="tab-signup">${t("checkout-tab-signup")}</button>
      <button type="button" class="checkout-auth-tab ${
        emailAuthTab === "signin" ? "is-active" : ""
      }" data-action="tab-signin">${t("checkout-tab-signin")}</button>
    </div>
  `;

  return `
    <div class="cart-drawer-header">
      <button type="button" class="cart-drawer-back" data-action="back">${t("checkout-back")}</button>
      <h2>${t("checkout-title")}</h2>
      <button type="button" class="cart-drawer-close" data-action="close" aria-label="${t("cart-close")}">&times;</button>
    </div>
    <div class="cart-drawer-body">
      ${tabs}
      ${emailAuthTab === "signup" ? signupFormHtml() : signinFormHtml()}
      <p class="checkout-or-divider">${t("checkout-or-continue-with")}</p>
      <button type="button" class="btn-dark checkout-google-btn" data-action="signin-google">${t(
        "checkout-signin-google"
      )}</button>
      <button type="button" class="btn-dark checkout-facebook-btn" data-action="signin-facebook">${t(
        "checkout-signin-facebook"
      )}</button>
    </div>
  `;
}

function signupFormHtml(): string {
  const err = (key: keyof SignupFormState) =>
    signupFieldErrorKeys[key] ? `<p class="checkout-field-error">${escapeHtml(t(signupFieldErrorKeys[key] as string))}</p>` : "";
  const cls = (key: keyof SignupFormState) => (signupFieldErrorKeys[key] ? "checkout-field has-error" : "checkout-field");

  return `
    ${signupErrorKey ? `<div class="checkout-error">${escapeHtml(t(signupErrorKey))}</div>` : ""}
    <form id="signupForm" novalidate>
      <div class="${cls("firstName")}">
        <label for="su-first-name">${t("checkout-first-name")}</label>
        <input id="su-first-name" name="firstName" type="text" value="${escapeAttr(signupForm.firstName)}" autocomplete="given-name" />
        ${err("firstName")}
      </div>
      <div class="${cls("lastName")}">
        <label for="su-last-name">${t("checkout-last-name")}</label>
        <input id="su-last-name" name="lastName" type="text" value="${escapeAttr(signupForm.lastName)}" autocomplete="family-name" />
        ${err("lastName")}
      </div>
      <div class="${cls("gender")}">
        <label>${t("checkout-gender")}</label>
        <div class="checkout-gender-options">
          <label class="checkout-radio"><input type="radio" name="gender" value="male" ${
            signupForm.gender === "male" ? "checked" : ""
          } /> ${t("checkout-gender-male")}</label>
          <label class="checkout-radio"><input type="radio" name="gender" value="female" ${
            signupForm.gender === "female" ? "checked" : ""
          } /> ${t("checkout-gender-female")}</label>
          <label class="checkout-radio"><input type="radio" name="gender" value="prefer_not_to_say" ${
            signupForm.gender === "prefer_not_to_say" ? "checked" : ""
          } /> ${t("checkout-gender-prefer-not-say")}</label>
        </div>
        ${err("gender")}
      </div>
      <div class="${cls("dateOfBirth")}">
        <label for="su-dob">${t("checkout-dob")}</label>
        <input id="su-dob" name="dateOfBirth" type="date" value="${escapeAttr(signupForm.dateOfBirth)}" autocomplete="bday" />
        <p class="checkout-field-hint">${t("checkout-dob-hint")}</p>
        ${err("dateOfBirth")}
      </div>
      <div class="${cls("email")}">
        <label for="su-email">${t("checkout-email")}</label>
        <input id="su-email" name="email" type="email" value="${escapeAttr(signupForm.email)}" autocomplete="email" />
        ${err("email")}
      </div>
      <div class="${cls("password")}">
        <label for="su-password">${t("checkout-password")}</label>
        <input id="su-password" name="password" type="password" value="${escapeAttr(signupForm.password)}" autocomplete="new-password" />
        ${err("password")}
      </div>
      <div class="${cls("passwordConfirm")}">
        <label for="su-password-confirm">${t("checkout-password-confirm")}</label>
        <input id="su-password-confirm" name="passwordConfirm" type="password" value="${escapeAttr(
          signupForm.passwordConfirm
        )}" autocomplete="new-password" />
        ${err("passwordConfirm")}
      </div>
      <label class="checkout-newsletter-confirm">
        <input type="checkbox" name="newsletterSubscribed" ${signupForm.newsletterSubscribed ? "checked" : ""} />
        <span>${t("checkout-newsletter")}</span>
      </label>
      <button type="submit" class="btn-gold checkout-auth-submit" ${signupSubmitting ? "disabled" : ""}>
        ${signupSubmitting ? t("checkout-submitting") : t("checkout-create-account-btn")}
      </button>
    </form>
  `;
}

function signinFormHtml(): string {
  const err = (key: "email" | "password") =>
    signinFieldErrorKeys[key] ? `<p class="checkout-field-error">${escapeHtml(t(signinFieldErrorKeys[key] as string))}</p>` : "";
  const cls = (key: "email" | "password") => (signinFieldErrorKeys[key] ? "checkout-field has-error" : "checkout-field");

  return `
    ${signinErrorKey ? `<div class="checkout-error">${escapeHtml(t(signinErrorKey))}</div>` : ""}
    <form id="signinForm" novalidate>
      <div class="${cls("email")}">
        <label for="si-email">${t("checkout-email")}</label>
        <input id="si-email" name="email" type="email" value="${escapeAttr(signinForm.email)}" autocomplete="email" />
        ${err("email")}
      </div>
      <div class="${cls("password")}">
        <label for="si-password">${t("checkout-password")}</label>
        <input id="si-password" name="password" type="password" value="${escapeAttr(signinForm.password)}" autocomplete="current-password" />
        ${err("password")}
      </div>
      <button type="submit" class="btn-gold checkout-auth-submit" ${signinSubmitting ? "disabled" : ""}>
        ${signinSubmitting ? t("checkout-submitting") : t("checkout-signin-btn")}
      </button>
    </form>
  `;
}

// ── OTP verification (after a successful signup) ──

function otpHtml(): string {
  return `
    <div class="cart-drawer-header">
      <button type="button" class="cart-drawer-back" data-action="back">${t("checkout-back")}</button>
      <h2>${t("checkout-title")}</h2>
      <button type="button" class="cart-drawer-close" data-action="close" aria-label="${t("cart-close")}">&times;</button>
    </div>
    <div class="cart-drawer-body">
      <div class="checkout-otp">
        <p class="checkout-otp-lead">${t("checkout-otp-lead").replace("{email}", escapeHtml(otpEmail))}</p>
        ${otpErrorKey ? `<div class="checkout-error">${escapeHtml(t(otpErrorKey))}</div>` : ""}
        <form id="otpForm" novalidate>
          <div class="checkout-field">
            <label for="otp-code">${t("checkout-otp-label")}</label>
            <input
              id="otp-code"
              name="otpCode"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="8"
              value="${escapeAttr(otpCode)}"
            />
          </div>
          <button type="submit" class="btn-gold checkout-auth-submit" ${otpSubmitting ? "disabled" : ""}>
            ${otpSubmitting ? t("checkout-submitting") : t("checkout-otp-verify-btn")}
          </button>
        </form>
        <button type="button" class="checkout-otp-resend" data-action="resend-otp">${t("checkout-otp-resend")}</button>
      </div>
    </div>
  `;
}

// ── Checkout view ──

function checkoutViewHtml(): string {
  const err = (key: keyof CheckoutRecipient) =>
    fieldErrorKeys[key] ? `<p class="checkout-field-error">${escapeHtml(t(fieldErrorKeys[key] as string))}</p>` : "";
  const cls = (key: keyof CheckoutRecipient) => (fieldErrorKeys[key] ? "checkout-field has-error" : "checkout-field");
  const session = getSession();
  const accountBar = session
    ? `<div class="checkout-account-bar">${t("checkout-signed-in-as")} <strong>${escapeHtml(
        session.user.email ?? ""
      )}</strong> <button type="button" class="checkout-signout-btn" data-action="sign-out">${t(
        "checkout-sign-out"
      )}</button></div>`
    : "";

  return `
    <div class="cart-drawer-header">
      <button type="button" class="cart-drawer-back" data-action="back">${t("checkout-back-to-cart")}</button>
      <h2>${t("checkout-title")}</h2>
      <button type="button" class="cart-drawer-close" data-action="close" aria-label="${t("cart-close")}">&times;</button>
    </div>
    <div class="cart-drawer-body">
      ${accountBar}
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
        <p id="ck-delivery-info" class="checkout-delivery-info">${deliveryInfoHtml(deliveryMethod)}</p>

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

// Neither delivery option is self-explanatory to a first-time buyer — standard
// delivery needs its fee/threshold stated up front, and self collection is
// meaningless without an address. Both texts live in i18n (script.js) so they
// stay in sync with the wording on policies/delivery.html.
function deliveryInfoHtml(method: DeliveryMethod): string {
  return method === "self_collection" ? t("checkout-self-collection-info") : t("checkout-standard-delivery-info");
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
          handleBack();
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
        case "continue-guest": {
          accountChoiceMade = true;
          // Empty cart means this was reached via the nav's "Sign In" entry,
          // not an actual checkout attempt — nothing to check out, so just
          // land back on the (empty) cart view instead of a checkout form
          // for zero items.
          if (store.getItems().length === 0) {
            backToCart();
          } else {
            checkoutStage = "form";
            renderDrawer();
          }
          break;
        }
        case "signin-google":
          window.localStorage.setItem(REOPEN_CHECKOUT_STORAGE_KEY, "1");
          void signInWithGoogle();
          break;
        case "signin-facebook":
          window.localStorage.setItem(REOPEN_CHECKOUT_STORAGE_KEY, "1");
          void signInWithFacebook();
          break;
        case "sign-out":
          void signOut();
          accountChoiceMade = false;
          checkoutStage = "account";
          renderDrawer();
          break;
        case "use-email":
          emailAuthTab = "signup";
          checkoutStage = "email-auth";
          renderDrawer();
          break;
        case "tab-signup":
          emailAuthTab = "signup";
          signupErrorKey = null;
          renderDrawer();
          break;
        case "tab-signin":
          emailAuthTab = "signin";
          signinErrorKey = null;
          renderDrawer();
          break;
        case "resend-otp":
          void handleResendOtp();
          break;
      }
    });
  });

  // Typing a qty directly (rather than clicking +/- one at a time) matters
  // for a wholesale-sized order — e.g. a customer buying a few hundred
  // bottles. `change` (fires on blur/Enter, not per keystroke) so a
  // half-typed value never triggers a store update mid-edit.
  drawerEl.querySelectorAll<HTMLInputElement>(".cart-item-qty-input").forEach((input) => {
    input.addEventListener("change", () => {
      const sku = input.closest<HTMLElement>(".cart-item")?.dataset.sku;
      if (!sku) return;
      const parsed = Math.floor(Number(input.value));
      if (!Number.isFinite(parsed)) {
        input.value = String(store.getItems().find((i) => i.sku === sku)?.qty ?? 1);
        return;
      }
      store.updateQty(sku, parsed); // handles qty <= 0 (removes) and the MAX_QTY_PER_ITEM cap itself
    });
  });

  if (view === "checkout") {
    if (checkoutStage === "form") wireCheckoutForm();
    else if (checkoutStage === "email-auth") wireEmailAuthForms();
    else if (checkoutStage === "email-otp") wireOtpForm();
  }
}

function wireEmailAuthForms(): void {
  const signupFormEl = document.getElementById("signupForm") as HTMLFormElement | null;
  if (signupFormEl) {
    signupFormEl.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement;
      if (isSignupTextField(target.name)) signupForm[target.name] = target.value;
    });
    signupFormEl.addEventListener("change", (e) => {
      const target = e.target as HTMLInputElement;
      if (target.name === "gender") signupForm.gender = target.value as Gender;
      else if (target.name === "newsletterSubscribed") signupForm.newsletterSubscribed = target.checked;
    });
    signupFormEl.addEventListener("submit", (e) => {
      e.preventDefault();
      void handleSignupSubmit();
    });
  }

  const signinFormEl = document.getElementById("signinForm") as HTMLFormElement | null;
  if (signinFormEl) {
    signinFormEl.addEventListener("input", (e) => {
      const target = e.target as HTMLInputElement;
      if (target.name === "email" || target.name === "password") {
        signinForm[target.name as "email" | "password"] = target.value;
      }
    });
    signinFormEl.addEventListener("submit", (e) => {
      e.preventDefault();
      void handleSigninSubmit();
    });
  }
}

function wireOtpForm(): void {
  const form = document.getElementById("otpForm") as HTMLFormElement | null;
  if (!form) return;
  form.addEventListener("input", (e) => {
    const target = e.target as HTMLInputElement;
    if (target.name === "otpCode") otpCode = target.value;
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void handleOtpSubmit();
  });
}

function isSignupTextField(
  name: string
): name is "firstName" | "lastName" | "dateOfBirth" | "email" | "password" | "passwordConfirm" {
  return ["firstName", "lastName", "dateOfBirth", "email", "password", "passwordConfirm"].includes(name);
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
      const infoEl = document.getElementById("ck-delivery-info");
      if (infoEl) infoEl.innerHTML = deliveryInfoHtml(deliveryMethod);
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

async function handleSignupSubmit(): Promise<void> {
  signupFieldErrorKeys = validateSignup(signupForm);
  if (Object.keys(signupFieldErrorKeys).length > 0) {
    signupErrorKey = null;
    renderDrawer();
    return;
  }

  signupSubmitting = true;
  signupErrorKey = null;
  renderDrawer();

  const { error } = await signUpWithPassword(signupForm.email, signupForm.password);
  signupSubmitting = false;

  if (error) {
    signupErrorKey = "checkout-signup-error-generic";
    renderDrawer();
    return;
  }

  // Stashed, not written yet — customer_profiles' RLS policy needs an
  // authenticated user, which only exists after the OTP below succeeds.
  pendingSignupProfile = {
    firstName: signupForm.firstName,
    lastName: signupForm.lastName,
    gender: signupForm.gender as Gender,
    dateOfBirth: signupForm.dateOfBirth,
    newsletterSubscribed: signupForm.newsletterSubscribed,
  };
  otpEmail = signupForm.email;
  otpCode = "";
  otpErrorKey = null;
  checkoutStage = "email-otp";
  renderDrawer();
}

function validateSignup(f: SignupFormState): Partial<Record<keyof SignupFormState, string>> {
  const errors: Partial<Record<keyof SignupFormState, string>> = {};
  const requiredKey = "checkout-field-required";
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!f.firstName.trim()) errors.firstName = requiredKey;
  if (!f.lastName.trim()) errors.lastName = requiredKey;
  if (!f.gender) errors.gender = requiredKey;
  if (!f.dateOfBirth) errors.dateOfBirth = requiredKey;
  else if (!isAtLeast18(f.dateOfBirth)) errors.dateOfBirth = "checkout-age-under-18";
  if (!f.email.trim() || !emailPattern.test(f.email)) errors.email = requiredKey;
  if (f.password.length < 8) errors.password = "checkout-password-too-short";
  if (f.passwordConfirm !== f.password) errors.passwordConfirm = "checkout-password-mismatch";
  return errors;
}

function isAtLeast18(dobStr: string): boolean {
  const dob = new Date(dobStr);
  if (Number.isNaN(dob.getTime())) return false;
  const eighteenYearsAgo = new Date();
  eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
  return dob <= eighteenYearsAgo;
}

async function handleSigninSubmit(): Promise<void> {
  const errors: Partial<Record<"email" | "password", string>> = {};
  if (!signinForm.email.trim()) errors.email = "checkout-field-required";
  if (!signinForm.password.trim()) errors.password = "checkout-field-required";
  signinFieldErrorKeys = errors;
  if (Object.keys(errors).length > 0) {
    signinErrorKey = null;
    renderDrawer();
    return;
  }

  signinSubmitting = true;
  signinErrorKey = null;
  renderDrawer();

  const { error } = await signInWithPassword(signinForm.email, signinForm.password);
  signinSubmitting = false;

  if (error) {
    signinErrorKey = "checkout-signin-error-generic";
    renderDrawer();
    return;
  }

  enterCheckoutFormAfterAuth();
}

async function handleOtpSubmit(): Promise<void> {
  if (!otpCode.trim()) {
    otpErrorKey = "checkout-field-required";
    renderDrawer();
    return;
  }

  otpSubmitting = true;
  otpErrorKey = null;
  renderDrawer();

  const { error } = await verifySignupOtp(otpEmail, otpCode.trim());
  otpSubmitting = false;

  if (error) {
    otpErrorKey = "checkout-otp-error-generic";
    renderDrawer();
    return;
  }

  if (pendingSignupProfile) {
    // Best-effort — a failure here shouldn't block someone who just verified
    // a real account from checking out; the profile fields are a nice-to-have
    // on top of a working account, not the account itself.
    const { error: profileError } = await saveCustomerProfile(pendingSignupProfile);
    if (profileError) showToast(t("checkout-profile-save-error"));
    pendingSignupProfile = null;
  }

  enterCheckoutFormAfterAuth();
}

async function handleResendOtp(): Promise<void> {
  if (!otpEmail) return;
  const { error } = await resendSignupOtp(otpEmail);
  otpErrorKey = error ? "checkout-otp-error-generic" : null;
  if (!error) showToast(t("checkout-otp-resent"));
  renderDrawer();
}

// Shared tail end of both the sign-in and OTP-verify success paths.
function enterCheckoutFormAfterAuth(): void {
  accountChoiceMade = true;
  const session = getSession();
  if (session?.user.email && !recipient.email) recipient.email = session.user.email;
  // Same empty-cart guard as "continue-guest" above — signing in from the
  // nav has no cart items to check out.
  if (store.getItems().length === 0) {
    view = "cart";
  } else {
    checkoutStage = "form";
  }
  renderDrawer();
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


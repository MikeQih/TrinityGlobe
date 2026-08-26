import { getSession, initAuth, onAuthChange } from "./auth";
import { escapeAttr, escapeHtml } from "./html-escape";
import { onLangChange, t } from "./i18n";
import { supabase } from "./lib/supabase";
import type { CustomerAddress } from "./types";

// Renders addresses.html's address book — a no-op everywhere else (guarded
// by #myAddressesRoot, same pattern as initOrdersPage()'s #myOrdersRoot).
// Reads/writes customer_addresses directly via supabase-js (same pattern as
// auth.ts#saveCustomerProfile) — RLS on that table is what actually
// restricts a customer to their own rows, not this code.
export function initAddressesPage(): void {
  const root = document.getElementById("myAddressesRoot");
  if (!root) return;

  let addresses: CustomerAddress[] = [];
  let showForm = false;
  let formErrorKey: string | null = null;
  let submitting = false;
  let requestId = 0;

  async function load(): Promise<void> {
    const session = getSession();
    if (!session || !supabase) {
      root!.innerHTML = signedOutHtml();
      wireSignInLink();
      return;
    }

    const thisRequest = ++requestId;
    root!.innerHTML = `<p class="orders-status">${t("addresses-loading")}</p>`;

    const { data, error } = await supabase
      .from("customer_addresses")
      .select("id, label, recipient_name, phone, address, postal_code, is_default")
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true });

    if (thisRequest !== requestId) return;

    if (error) {
      root!.innerHTML = `<p class="orders-status">${escapeHtml(t("addresses-load-error"))}</p>`;
      return;
    }

    addresses = (data ?? []).map((row) => ({
      id: row.id as string,
      label: row.label as string | null,
      recipientName: row.recipient_name as string,
      phone: row.phone as string,
      address: row.address as string,
      postalCode: row.postal_code as string,
      isDefault: row.is_default as boolean,
    }));
    showForm = addresses.length === 0;
    render();
  }

  function render(): void {
    root!.innerHTML = `
      ${addresses.length === 0 ? `<p class="orders-status">${t("addresses-empty")}</p>` : addresses.map(addressCardHtml).join("")}
      ${
        showForm
          ? addressFormHtml()
          : `<button type="button" class="btn-dark addresses-add-btn" data-action="show-form">${escapeHtml(
              t("addresses-add-new")
            )}</button>`
      }
    `;
    wireEvents();
  }

  function addressCardHtml(a: CustomerAddress): string {
    return `
      <div class="address-card">
        <div class="address-card-header">
          <span class="address-card-label">${escapeHtml(a.label || t("addresses-untitled"))}</span>
          ${a.isDefault ? `<span class="address-default-badge">${escapeHtml(t("addresses-default-badge"))}</span>` : ""}
        </div>
        <p class="address-card-body">
          ${escapeHtml(a.recipientName)} &middot; ${escapeHtml(a.phone)}<br />
          ${escapeHtml(a.address)}, ${escapeHtml(a.postalCode)}
        </p>
        <div class="address-card-actions">
          ${
            a.isDefault
              ? ""
              : `<button type="button" class="address-card-action" data-action="set-default" data-id="${escapeAttr(
                  a.id
                )}">${escapeHtml(t("addresses-set-default"))}</button>`
          }
          <button type="button" class="address-card-action" data-action="delete" data-id="${escapeAttr(
            a.id
          )}">${escapeHtml(t("addresses-delete"))}</button>
        </div>
      </div>
    `;
  }

  function addressFormHtml(): string {
    return `
      ${formErrorKey ? `<div class="checkout-error">${escapeHtml(t(formErrorKey))}</div>` : ""}
      <form id="addressForm" class="address-form" novalidate>
        <div class="checkout-field">
          <label for="addr-label">${escapeHtml(t("addresses-field-label"))}</label>
          <input id="addr-label" name="label" type="text" />
        </div>
        <div class="checkout-field">
          <label for="addr-recipient">${escapeHtml(t("addresses-field-recipient"))}</label>
          <input id="addr-recipient" name="recipientName" type="text" required />
        </div>
        <div class="checkout-field">
          <label for="addr-phone">${escapeHtml(t("addresses-field-phone"))}</label>
          <input id="addr-phone" name="phone" type="tel" required />
        </div>
        <div class="checkout-field">
          <label for="addr-address">${escapeHtml(t("addresses-field-address"))}</label>
          <textarea id="addr-address" name="address" rows="2" required></textarea>
        </div>
        <div class="checkout-field">
          <label for="addr-postal">${escapeHtml(t("addresses-field-postal"))}</label>
          <input id="addr-postal" name="postalCode" type="text" required />
        </div>
        <label class="checkout-newsletter-confirm">
          <input type="checkbox" name="isDefault" ${addresses.length === 0 ? "checked disabled" : ""} />
          <span>${escapeHtml(t("addresses-field-default"))}</span>
        </label>
        <div class="address-form-actions">
          <button type="submit" class="btn-gold" ${submitting ? "disabled" : ""}>
            ${escapeHtml(submitting ? t("checkout-submitting") : t("addresses-save"))}
          </button>
          ${
            addresses.length > 0
              ? `<button type="button" class="address-card-action" data-action="cancel-form">${escapeHtml(
                  t("addresses-cancel")
                )}</button>`
              : ""
          }
        </div>
      </form>
    `;
  }

  function wireEvents(): void {
    root!.querySelector('[data-action="show-form"]')?.addEventListener("click", () => {
      showForm = true;
      formErrorKey = null;
      render();
    });
    root!.querySelector('[data-action="cancel-form"]')?.addEventListener("click", () => {
      showForm = false;
      formErrorKey = null;
      render();
    });
    root!.querySelectorAll<HTMLButtonElement>('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener("click", () => void handleDelete(btn.dataset.id!));
    });
    root!.querySelectorAll<HTMLButtonElement>('[data-action="set-default"]').forEach((btn) => {
      btn.addEventListener("click", () => void handleSetDefault(btn.dataset.id!));
    });
    root!.querySelector<HTMLFormElement>("#addressForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      void handleSubmit(e.target as HTMLFormElement);
    });
  }

  async function handleSubmit(form: HTMLFormElement): Promise<void> {
    if (!supabase) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const fd = new FormData(form);
    const recipientName = String(fd.get("recipientName") ?? "").trim();
    const phone = String(fd.get("phone") ?? "").trim();
    const address = String(fd.get("address") ?? "").trim();
    const postalCode = String(fd.get("postalCode") ?? "").trim();
    if (!recipientName || !phone || !address || !postalCode) {
      formErrorKey = "addresses-error-required";
      render();
      return;
    }

    submitting = true;
    render();

    const isDefault = fd.get("isDefault") != null;
    if (isDefault) {
      // Only one row can be the default — clear the previous one first so
      // the new insert never leaves two rows both marked default.
      await supabase.from("customer_addresses").update({ is_default: false }).eq("user_id", user.id);
    }

    const { error } = await supabase.from("customer_addresses").insert({
      user_id: user.id,
      label: String(fd.get("label") ?? "").trim() || null,
      recipient_name: recipientName,
      phone,
      address,
      postal_code: postalCode,
      is_default: isDefault,
    });

    submitting = false;
    if (error) {
      formErrorKey = "addresses-error-save";
      render();
      return;
    }
    showForm = false;
    formErrorKey = null;
    await load();
  }

  async function handleDelete(id: string): Promise<void> {
    if (!supabase) return;
    await supabase.from("customer_addresses").delete().eq("id", id);
    await load();
  }

  async function handleSetDefault(id: string): Promise<void> {
    if (!supabase) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("customer_addresses").update({ is_default: false }).eq("user_id", user.id);
    await supabase.from("customer_addresses").update({ is_default: true }).eq("id", id);
    await load();
  }

  function wireSignInLink(): void {
    root!.querySelector("#addressesSignInLink")?.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = "/?signin=1";
    });
  }

  void initAuth().then(load);
  onAuthChange(load);
  // Re-checks session too (not just render()) — a lang toggle while signed
  // out must keep showing the signed-out message, not fall through to
  // render()'s signed-in-only markup.
  onLangChange(load);
}

function signedOutHtml(): string {
  return `
    <p class="orders-status">${t("addresses-signed-out")}</p>
    <a href="#" class="btn-gold orders-signin-btn" id="addressesSignInLink">${escapeHtml(t("nav-sign-in"))}</a>
  `;
}

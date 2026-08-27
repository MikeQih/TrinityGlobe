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
  // "list" shows saved addresses (or the empty state); "form" shows the
  // add/edit form. Deliberately not driven by addresses.length===0 anymore —
  // an empty book shows a friendly empty state with an explicit "add" button
  // rather than jumping straight to a bare form (see the design note this
  // was changed in response to: a first-time visitor with no addresses saw
  // nothing but an unlabelled form, which read as broken).
  let mode: "list" | "form" = "list";
  let editingId: string | null = null;
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
      .select("id, label, recipient_name, phone, address, postal_code, unit_number, is_default")
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
      unitNumber: row.unit_number as string | null,
      isDefault: row.is_default as boolean,
    }));
    render();
  }

  function render(): void {
    if (mode === "form") {
      root!.innerHTML = addressFormHtml();
    } else if (addresses.length === 0) {
      root!.innerHTML = emptyStateHtml();
    } else {
      root!.innerHTML = `
        ${addresses.map(addressCardHtml).join("")}
        <button type="button" class="btn-dark addresses-add-btn" data-action="show-form">${escapeHtml(
          t("addresses-add-new")
        )}</button>
      `;
    }
    wireEvents();
  }

  function emptyStateHtml(): string {
    return `
      <div class="addresses-empty-state">
        <p class="addresses-empty-title">${escapeHtml(t("addresses-empty-title"))}</p>
        <p class="addresses-empty-subtitle">${escapeHtml(t("addresses-empty-subtitle"))}</p>
        <button type="button" class="btn-gold" data-action="show-form">${escapeHtml(t("addresses-add-new"))}</button>
      </div>
    `;
  }

  function addressCardHtml(a: CustomerAddress): string {
    const addressLine = [a.address, a.unitNumber, a.postalCode]
      .filter((part): part is string => Boolean(part))
      .map(escapeHtml)
      .join(", ");
    return `
      <div class="address-card">
        <div class="address-card-header">
          <span class="address-card-label">${escapeHtml(a.label || t("addresses-untitled"))}</span>
          ${a.isDefault ? `<span class="address-default-badge">${escapeHtml(t("addresses-default-badge"))}</span>` : ""}
        </div>
        <p class="address-card-body">
          ${escapeHtml(a.recipientName)} &middot; ${escapeHtml(a.phone)}<br />
          ${addressLine}
        </p>
        <div class="address-card-actions">
          <button type="button" class="address-card-action" data-action="edit" data-id="${escapeAttr(
            a.id
          )}">${escapeHtml(t("addresses-edit"))}</button>
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
    const editing = editingId ? addresses.find((a) => a.id === editingId) : null;
    // Editing the account's only address, or the only default, must not let
    // the checkbox be unchecked into "no default at all" — same reasoning
    // as the add-form's "first address is always default" lock below.
    const lockDefaultChecked = editing ? editing.isDefault && addresses.filter((a) => a.isDefault).length <= 1 : addresses.length === 0;

    return `
      ${formErrorKey ? `<div class="checkout-error">${escapeHtml(t(formErrorKey))}</div>` : ""}
      <form id="addressForm" class="address-form" novalidate>
        <div class="checkout-field">
          <label for="addr-label">${escapeHtml(t("addresses-field-label"))}</label>
          <input id="addr-label" name="label" type="text" value="${escapeAttr(editing?.label ?? "")}" />
        </div>
        <div class="checkout-field">
          <label for="addr-recipient">${escapeHtml(t("addresses-field-recipient"))}</label>
          <input id="addr-recipient" name="recipientName" type="text" required value="${escapeAttr(
            editing?.recipientName ?? ""
          )}" />
        </div>
        <div class="checkout-field">
          <label for="addr-phone">${escapeHtml(t("addresses-field-phone"))}</label>
          <input id="addr-phone" name="phone" type="tel" required value="${escapeAttr(editing?.phone ?? "")}" />
        </div>
        <div class="checkout-field">
          <label for="addr-postal">${escapeHtml(t("addresses-field-postal"))}</label>
          <input id="addr-postal" name="postalCode" type="text" required value="${escapeAttr(editing?.postalCode ?? "")}" />
        </div>
        <div class="checkout-field">
          <label for="addr-address">${escapeHtml(t("addresses-field-address"))}</label>
          <textarea id="addr-address" name="address" rows="2" required>${escapeHtml(editing?.address ?? "")}</textarea>
        </div>
        <div class="checkout-field">
          <label for="addr-unit">${escapeHtml(t("addresses-field-unit"))}</label>
          <input id="addr-unit" name="unitNumber" type="text" value="${escapeAttr(editing?.unitNumber ?? "")}" />
        </div>
        <label class="checkout-newsletter-confirm">
          <input type="checkbox" ${lockDefaultChecked ? "checked disabled" : `name="isDefault" ${editing?.isDefault ? "checked" : ""}`} />
          <span>${escapeHtml(t("addresses-field-default"))}</span>
        </label>
        ${
          // A disabled checkbox is excluded from FormData entirely — this
          // carries the locked "always default" value through submission
          // instead (see the "first/only address is always default" lock
          // above).
          lockDefaultChecked ? `<input type="hidden" name="isDefault" value="true" />` : ""
        }
        <div class="address-form-actions">
          <button type="submit" class="btn-gold" ${submitting ? "disabled" : ""}>
            ${escapeHtml(submitting ? t("checkout-submitting") : t(editingId ? "addresses-update" : "addresses-save"))}
          </button>
          <button type="button" class="address-card-action" data-action="cancel-form">${escapeHtml(t("addresses-cancel"))}</button>
        </div>
      </form>
    `;
  }

  function wireEvents(): void {
    root!.querySelector('[data-action="show-form"]')?.addEventListener("click", () => {
      mode = "form";
      editingId = null;
      formErrorKey = null;
      render();
    });
    root!.querySelector('[data-action="cancel-form"]')?.addEventListener("click", () => {
      mode = "list";
      editingId = null;
      formErrorKey = null;
      render();
    });
    root!.querySelectorAll<HTMLButtonElement>('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        editingId = btn.dataset.id!;
        mode = "form";
        formErrorKey = null;
        render();
      });
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
    // is_default is deliberately never set directly here — see
    // set_default_customer_address (supabase/migrations/
    // 0010_default_address_uniqueness.sql), which clears every other
    // default and sets this one in a single atomic statement. Setting it
    // as a plain field on this insert/update, with a separate "clear the
    // old default first" call beforehand, was the previous approach and
    // wasn't atomic — two concurrent saves could each pass the "clear"
    // step before either ran its "set" step, leaving two rows marked
    // default. A DB-level unique index now backs this up regardless.
    const row = {
      label: String(fd.get("label") ?? "").trim() || null,
      recipient_name: recipientName,
      phone,
      address,
      postal_code: postalCode,
      unit_number: String(fd.get("unitNumber") ?? "").trim() || null,
    };

    const { data: savedId, error } = editingId
      ? await supabase
          .from("customer_addresses")
          .update(row)
          .eq("id", editingId)
          .select("id")
          .single()
          .then((r) => ({ data: r.data?.id as string | undefined, error: r.error }))
      : await supabase
          .from("customer_addresses")
          .insert({ ...row, user_id: user.id })
          .select("id")
          .single()
          .then((r) => ({ data: r.data?.id as string | undefined, error: r.error }));

    if (!error && isDefault && savedId) {
      const { error: defaultError } = await supabase.rpc("set_default_customer_address", {
        p_user_id: user.id,
        p_address_id: savedId,
      });
      if (defaultError) console.error("addresses-page: set_default_customer_address failed", defaultError);
    }

    submitting = false;
    if (error) {
      formErrorKey = "addresses-error-save";
      render();
      return;
    }
    mode = "list";
    editingId = null;
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
    const { error } = await supabase.rpc("set_default_customer_address", { p_user_id: user.id, p_address_id: id });
    if (error) console.error("addresses-page: set_default_customer_address failed", error);
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

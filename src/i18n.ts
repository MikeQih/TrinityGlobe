import type { ProductSummary } from "./types";

// script.js (a classic, non-module script loaded before this bundle) exposes
// this small explicit bridge — see the "Bridge for assets/storefront.js"
// comment in script.js for why we don't just read its globals directly.
declare global {
  interface Window {
    TG_I18N?: { t: (key: string) => string; getLang: () => string };
    TG_ON_LANG_CHANGE?: Array<() => void>;
    TG_PRODUCTS?: ProductSummary[];
  }
}

export function t(key: string): string {
  return window.TG_I18N?.t(key) ?? key;
}

/** Current site language ("en"/"zh") — see script.js's `currentLang`. Used at checkout time to snapshot which language the customer was browsing in (see 0021_order_locale_snapshot.sql); never used for anything else. */
export function getLang(): "en" | "zh" {
  return window.TG_I18N?.getLang() === "zh" ? "zh" : "en";
}

/** Registers `cb` to run whenever the site-wide language toggle fires. */
export function onLangChange(cb: () => void): void {
  window.TG_ON_LANG_CHANGE = window.TG_ON_LANG_CHANGE ?? [];
  window.TG_ON_LANG_CHANGE.push(cb);
}

export function getProductBySku(sku: string): ProductSummary | undefined {
  return window.TG_PRODUCTS?.find((p) => p.sku === sku);
}

export function formatCents(cents: number): string {
  return "S$" + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

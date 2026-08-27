// Entry point bundled by Vite into assets/storefront.js and loaded by
// index.html via <script type="module" src="/assets/storefront.js" defer>.

import { initCart, initAccountNav } from "./cart";
import { initOrdersPage } from "./orders-page";
import { initAddressesPage } from "./addresses-page";

function boot(): void {
  initCart();
  initAccountNav();
  initOrdersPage();
  initAddressesPage();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

// Entry point bundled by Vite into assets/storefront.js and loaded by
// index.html via <script type="module" src="/assets/storefront.js" defer>.

import { initCart } from "./cart";

function boot(): void {
  initCart();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

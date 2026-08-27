import { defineConfig } from "vite";

/**
 * The existing site is a plain static HTML/CSS/JS page (index.html, style.css,
 * script.js) served as-is by Netlify. We do NOT want Vite to take over the HTML
 * entry or touch the existing static assets — it only compiles the new
 * cart/checkout TypeScript into a single fixed-name bundle that index.html
 * loads via a plain <script type="module"> tag, exactly like script.js today.
 *
 * Output lands in ./assets (a build artifact, gitignored) so `publish = "."`
 * in netlify.toml can serve it alongside the untouched root-level files.
 */
export default defineConfig({
  build: {
    outDir: "assets",
    emptyOutDir: true,
    lib: {
      entry: "src/main.ts",
      formats: ["es"],
      fileName: () => "storefront.js",
    },
  },
});

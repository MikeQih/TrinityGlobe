import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Deliberately a separate Vite app/build from the storefront — it's staff
// tooling, not something the public site ships, so it deploys on its own
// (e.g. a separate Netlify site at admin.trinityglobe.sg, or any static
// host) rather than bundling into assets/storefront.js.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
});

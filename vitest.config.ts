import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom", // cart-store.ts uses localStorage
    include: ["tests/**/*.test.ts"],
  },
});

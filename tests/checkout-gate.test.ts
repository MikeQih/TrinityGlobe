import { describe, it, expect, afterEach } from "vitest";
import { isCheckoutEnabled, checkoutDisabledResponse } from "../netlify/functions/_lib/checkout-gate";

const ORIGINAL = process.env.CHECKOUT_ENABLED;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CHECKOUT_ENABLED;
  else process.env.CHECKOUT_ENABLED = ORIGINAL;
});

describe("isCheckoutEnabled (fail-closed)", () => {
  it("is disabled when the env var is unset", () => {
    delete process.env.CHECKOUT_ENABLED;
    expect(isCheckoutEnabled()).toBe(false);
  });

  it("is disabled when the env var is an empty string", () => {
    process.env.CHECKOUT_ENABLED = "";
    expect(isCheckoutEnabled()).toBe(false);
  });

  it('is disabled when the env var is "false"', () => {
    process.env.CHECKOUT_ENABLED = "false";
    expect(isCheckoutEnabled()).toBe(false);
  });

  it.each(["1", "TRUE", "True", " true", "true ", "yes", "enabled"])(
    "is disabled for any non-exact-match value: %j",
    (value) => {
      process.env.CHECKOUT_ENABLED = value;
      expect(isCheckoutEnabled()).toBe(false);
    }
  );

  it('is enabled only when the env var is exactly "true"', () => {
    process.env.CHECKOUT_ENABLED = "true";
    expect(isCheckoutEnabled()).toBe(true);
  });
});

describe("checkoutDisabledResponse", () => {
  it("returns a 503 with the stable checkout_disabled error code", async () => {
    const res = checkoutDisabledResponse();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.code).toBe("checkout_disabled");
  });
});

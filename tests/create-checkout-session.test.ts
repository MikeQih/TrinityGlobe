import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocked before the handler module is imported (vitest hoists vi.mock calls)
// so create-checkout-session.ts's own imports resolve to these fakes instead
// of a real Supabase/Stripe client. Mirrors the mocking style used in
// tests/admin-refund-order.test.ts.
const rpcImpl = vi.fn();
const getUserIdFromRequestImpl = vi.fn();
const releaseOrderReservationsImpl = vi.fn();
const sessionsCreate = vi.fn();
const sessionsRetrieve = vi.fn();

let storeSettingsRow: {
  standard_shipping_fee_cents: number;
  free_shipping_threshold_cents: number;
  gst_rate: number;
  gst_registration_effective_at: string | null;
};
let productVariantsRows: Array<{
  sku: string;
  name_snapshot: string;
  unit_price_cents: number;
  case_size: number | null;
  case_price_cents: number | null;
  five_case_size: number | null;
  five_case_price_cents: number | null;
  is_active: boolean;
  allow_self_collection: boolean;
}>;

function eqChain(result: unknown): unknown {
  const p = Promise.resolve(result);
  return Object.assign(p, { eq: () => eqChain(result) });
}

vi.mock("../netlify/functions/_lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "store_settings") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: storeSettingsRow, error: null }),
            }),
          }),
        };
      }
      if (table === "product_variants") {
        return {
          select: () => ({
            in: () => {
              const p = Promise.resolve({ data: productVariantsRows, error: null });
              return Object.assign(p, { returns: () => p });
            },
          }),
        };
      }
      if (table === "orders") {
        return {
          // Idempotency lookup (no checkoutAttemptId reuse in these tests).
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
          }),
          update: () => ({ eq: (col: string, val: unknown) => eqChain({ data: null, error: null }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (name: string, args: unknown) => {
      const p = Promise.resolve(rpcImpl(name, args));
      return Object.assign(p, { single: () => p });
    },
  }),
  getUserIdFromRequest: (req: Request) => getUserIdFromRequestImpl(req),
  releaseOrderReservations: (...args: unknown[]) => releaseOrderReservationsImpl(...args),
}));

vi.mock("../netlify/functions/_lib/stripe", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        create: sessionsCreate,
        retrieve: sessionsRetrieve,
      },
    },
  }),
}));

import handler from "../netlify/functions/create-checkout-session";

const TEST_SKU = "GOLIVE-HIDDEN-TEST-SKU";
const TEST_EMAIL = "delivered@resend.dev";
const REAL_SKU = "BEER-HAPPY-BREW-LAGER";

const validRecipient = {
  name: "Test Customer",
  phone: "91234567",
  email: TEST_EMAIL,
  address: "1 Test Street",
  postalCode: "123456",
  notes: "",
};

function checkoutBody(overrides: Record<string, unknown> = {}) {
  return {
    items: [{ sku: TEST_SKU, qty: 1 }],
    deliveryMethod: "standard",
    recipient: validRecipient,
    ageConfirmed: true,
    ...overrides,
  };
}

function makeRequest(body: unknown): Request {
  return new Request("https://example.test/.netlify/functions/create-checkout-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const fakeContext = { ip: "203.0.113.1" } as unknown as import("@netlify/functions").Context;

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  process.env.CHECKOUT_ENABLED = "true";
  process.env.SITE_URL = "https://trinityglobe.test";
  delete process.env.GOLIVE_TEST_SKU;
  delete process.env.GOLIVE_TEST_EMAIL;

  storeSettingsRow = {
    standard_shipping_fee_cents: 1500, // S$15
    free_shipping_threshold_cents: 12000, // S$120
    gst_rate: 0,
    gst_registration_effective_at: null,
  };
  productVariantsRows = [
    {
      sku: TEST_SKU,
      name_snapshot: "Go-Live Verification Item",
      unit_price_cents: 50,
      case_size: null,
      case_price_cents: null,
      five_case_size: null,
      five_case_price_cents: null,
      is_active: true,
      allow_self_collection: true,
    },
    {
      sku: REAL_SKU,
      name_snapshot: "Happy Brew Lager",
      unit_price_cents: 600,
      case_size: null,
      case_price_cents: null,
      five_case_size: null,
      five_case_price_cents: null,
      is_active: true,
      allow_self_collection: true,
    },
  ];

  getUserIdFromRequestImpl.mockResolvedValue(null);
  rpcImpl.mockImplementation((name: string) => {
    if (name === "create_pending_order") return { data: { id: "11111111-1111-1111-1111-111111111111" }, error: null };
    throw new Error(`unexpected rpc ${name}`);
  });
  sessionsCreate.mockResolvedValue({ id: "cs_test_123", url: "https://checkout.stripe.test/pay/cs_test_123", ui_mode: null });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("create-checkout-session — go-live test shipping exemption", () => {
  it("12. CHECKOUT_ENABLED=false still returns 503 for the hidden test SKU, gate cannot be bypassed", async () => {
    process.env.CHECKOUT_ENABLED = "false";
    process.env.GOLIVE_TEST_SKU = TEST_SKU;
    process.env.GOLIVE_TEST_EMAIL = TEST_EMAIL;

    const res = await handler(makeRequest(checkoutBody()), fakeContext);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe("checkout_disabled");
    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(rpcImpl).not.toHaveBeenCalled();
  });

  it("8. inactive test SKU is refused before the exemption is ever evaluated", async () => {
    process.env.GOLIVE_TEST_SKU = TEST_SKU;
    process.env.GOLIVE_TEST_EMAIL = TEST_EMAIL;
    productVariantsRows[0]!.is_active = false;

    const res = await handler(makeRequest(checkoutBody()), fakeContext);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("insufficient_stock");
    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(rpcImpl).not.toHaveBeenCalled();
  });

  it("9. full match: shipping is S$0, order total is S$0.50, no Shipping line item sent to Stripe", async () => {
    process.env.GOLIVE_TEST_SKU = TEST_SKU;
    process.env.GOLIVE_TEST_EMAIL = TEST_EMAIL;

    const res = await handler(makeRequest(checkoutBody()), fakeContext);

    expect(res.status).toBe(200);
    expect(rpcImpl).toHaveBeenCalledWith(
      "create_pending_order",
      expect.objectContaining({ p_subtotal_cents: 50, p_shipping_fee_cents: 0, p_total_cents: 50 })
    );
    const sessionParams = sessionsCreate.mock.calls[0]![0];
    expect(sessionParams.line_items).toHaveLength(1); // item only, no "Shipping" line
    expect(sessionParams.line_items[0].price_data.unit_amount).toBe(50);
  });

  it("env vars set but this is a normal real order -> real S$15 shipping / S$120 threshold untouched (S$6 item -> S$21 total)", async () => {
    process.env.GOLIVE_TEST_SKU = TEST_SKU;
    process.env.GOLIVE_TEST_EMAIL = TEST_EMAIL;

    const res = await handler(
      makeRequest(checkoutBody({ items: [{ sku: REAL_SKU, qty: 1 }], recipient: { ...validRecipient, email: "real-customer@example.com" } })),
      fakeContext
    );

    expect(res.status).toBe(200);
    expect(rpcImpl).toHaveBeenCalledWith(
      "create_pending_order",
      expect.objectContaining({ p_subtotal_cents: 600, p_shipping_fee_cents: 1500, p_total_cents: 2100 })
    );
  });

  it("10. real order still gets free shipping once its own subtotal clears S$120, independent of the exemption", async () => {
    process.env.GOLIVE_TEST_SKU = TEST_SKU;
    process.env.GOLIVE_TEST_EMAIL = TEST_EMAIL;
    productVariantsRows[1]!.unit_price_cents = 12500; // single bottle already over the S$120 threshold

    const res = await handler(
      makeRequest(checkoutBody({ items: [{ sku: REAL_SKU, qty: 1 }], recipient: { ...validRecipient, email: "real-customer@example.com" } })),
      fakeContext
    );

    expect(res.status).toBe(200);
    expect(rpcImpl).toHaveBeenCalledWith(
      "create_pending_order",
      expect.objectContaining({ p_shipping_fee_cents: 0, p_total_cents: 12500 })
    );
  });

  it("11. a client-supplied price field is ignored — the DB price is what's charged", async () => {
    process.env.GOLIVE_TEST_SKU = TEST_SKU;
    process.env.GOLIVE_TEST_EMAIL = TEST_EMAIL;

    const res = await handler(
      makeRequest(checkoutBody({ items: [{ sku: TEST_SKU, qty: 1, unitPriceCents: 1, priceCents: 1 }] })),
      fakeContext
    );

    expect(res.status).toBe(200);
    // Server still computed 50 cents (from the DB row), not the smuggled 1 cent.
    expect(rpcImpl).toHaveBeenCalledWith(
      "create_pending_order",
      expect.objectContaining({ p_subtotal_cents: 50, p_shipping_fee_cents: 0, p_total_cents: 50 })
    );
  });

  it("exemption stays dormant when both env vars are unset, even for what would otherwise be a matching cart", async () => {
    // GOLIVE_TEST_SKU / GOLIVE_TEST_EMAIL both left unset by beforeEach.
    const res = await handler(makeRequest(checkoutBody()), fakeContext);

    expect(res.status).toBe(200);
    expect(rpcImpl).toHaveBeenCalledWith(
      "create_pending_order",
      expect.objectContaining({ p_shipping_fee_cents: 1500, p_total_cents: 1550 })
    );
  });

  it("wrong recipient email with an otherwise-matching cart still pays real shipping", async () => {
    process.env.GOLIVE_TEST_SKU = TEST_SKU;
    process.env.GOLIVE_TEST_EMAIL = TEST_EMAIL;

    const res = await handler(
      makeRequest(checkoutBody({ recipient: { ...validRecipient, email: "not-the-test-email@example.com" } })),
      fakeContext
    );

    expect(res.status).toBe(200);
    expect(rpcImpl).toHaveBeenCalledWith(
      "create_pending_order",
      expect.objectContaining({ p_shipping_fee_cents: 1500, p_total_cents: 1550 })
    );
  });

  it("qty of 2 for the test SKU still pays real shipping (exemption requires exactly qty 1)", async () => {
    process.env.GOLIVE_TEST_SKU = TEST_SKU;
    process.env.GOLIVE_TEST_EMAIL = TEST_EMAIL;

    const res = await handler(makeRequest(checkoutBody({ items: [{ sku: TEST_SKU, qty: 2 }] })), fakeContext);

    expect(res.status).toBe(200);
    expect(rpcImpl).toHaveBeenCalledWith(
      "create_pending_order",
      expect.objectContaining({ p_subtotal_cents: 100, p_shipping_fee_cents: 1500, p_total_cents: 1600 })
    );
  });
});

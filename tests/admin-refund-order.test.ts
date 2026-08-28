import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

// Mocked before the handler module is imported (vitest hoists vi.mock calls
// to the top of the file) so admin-refund-order.ts's own `import {
// getSupabaseAdmin } from "./_lib/supabase"` and `import { getStripe,
// refundFailureReason } from "./_lib/stripe"` resolve to these fakes
// instead of ever touching real env vars, a real Stripe client, or a real
// database. Each test configures the two vi.fn()s (`refundsCreate`,
// `rpcImpl`) it needs and asserts on how the handler called them.
const refundsCreate = vi.fn();
const rpcImpl = vi.fn();
const getUserImpl = vi.fn();

vi.mock("../netlify/functions/_lib/stripe", async () => {
  const actual = await vi.importActual<typeof import("../netlify/functions/_lib/stripe")>(
    "../netlify/functions/_lib/stripe"
  );
  return {
    getStripe: () => ({ refunds: { create: refundsCreate } }),
    // The real refundFailureReason has no dependency on a live Stripe
    // client — reuse it as-is so the tests exercise the actual mapping.
    refundFailureReason: actual.refundFailureReason,
  };
});

// The real supabase-js `.rpc()` return value is both awaitable directly
// (bind_refund_stripe_id / apply_refund_status are called this way) *and*
// chainable with `.single()` (claim_refund_request is called this way, to
// unwrap the one-row result Postgres returns for a `returns refund_requests`
// function). This wrapper supports both without modelling the rest of
// PostgrestFilterBuilder.
function rpcChain(result: unknown) {
  const promise = Promise.resolve(result);
  return Object.assign(promise, { single: () => promise });
}

vi.mock("../netlify/functions/_lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    auth: { getUser: getUserImpl },
    from: (table: string) => makeQueryBuilder(table),
    rpc: (name: string, args: unknown) => rpcChain(rpcImpl(name, args)),
  }),
}));

// A single chainable stand-in for every `.from(table).select(...).eq(...).
// maybeSingle()/.single()` call the handler makes. Resolution is delegated
// to `fromResolvers[table]`, configured per test — enough to cover every
// query shape this handler actually uses without modelling PostgREST's
// full query builder.
const fromResolvers: Record<string, () => { data: unknown; error: unknown }> = {};
function makeQueryBuilder(table: string) {
  const resolve = () => (fromResolvers[table] ? fromResolvers[table]() : { data: null, error: null });
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = () => Promise.resolve(resolve());
  chain.single = () => Promise.resolve(resolve());
  return chain;
}

let handler: typeof import("../netlify/functions/admin-refund-order").default;

beforeEach(async () => {
  vi.clearAllMocks();
  Object.keys(fromResolvers).forEach((k) => delete fromResolvers[k]);
  getUserImpl.mockResolvedValue({ data: { user: { id: "admin-user-1" } }, error: null });
  fromResolvers.admin_profiles = () => ({ data: { role: "admin" }, error: null });
  fromResolvers.orders = () => ({ data: { stripe_payment_intent_id: "pi_test_123" }, error: null });
  ({ default: handler } = await import("../netlify/functions/admin-refund-order"));
});

function makeRequest(body: unknown, token = "valid-token"): Request {
  return new Request("https://example.test/.netlify/functions/admin-refund-order", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

const claimedRow = { id: "req-1", order_id: "11111111-1111-1111-1111-111111111111", amount_cents: 10000 };

describe("admin-refund-order — refund status handling", () => {
  it("Card refund: refunds.create returns succeeded synchronously -> apply_refund_status called with succeeded, response reports succeeded", async () => {
    rpcImpl.mockImplementation((name: string) => {
      if (name === "claim_refund_request") return Promise.resolve({ data: claimedRow, error: null });
      if (name === "bind_refund_stripe_id") return Promise.resolve({ data: null, error: null });
      if (name === "apply_refund_status") return Promise.resolve({ data: "applied_succeeded", error: null });
      throw new Error(`unexpected rpc ${name}`);
    });
    fromResolvers.orders = () => ({ data: { stripe_payment_intent_id: "pi_test_123", refunded_cents: 10000, status: "refunded" }, error: null });
    refundsCreate.mockResolvedValue({ id: "re_card_1", status: "succeeded" });

    const res = await handler(makeRequest({ orderId: "11111111-1111-1111-1111-111111111111" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "succeeded", refundedCents: 10000 });
    expect(rpcImpl).toHaveBeenCalledWith(
      "apply_refund_status",
      expect.objectContaining({ p_stripe_status: "succeeded", p_stripe_refund_id: "re_card_1" })
    );
  });

  it("PayNow refund: refunds.create returns pending -> response reports pending, never succeeded", async () => {
    rpcImpl.mockImplementation((name: string) => {
      if (name === "claim_refund_request") return Promise.resolve({ data: claimedRow, error: null });
      if (name === "bind_refund_stripe_id") return Promise.resolve({ data: null, error: null });
      if (name === "apply_refund_status") return Promise.resolve({ data: "applied_pending", error: null });
      throw new Error(`unexpected rpc ${name}`);
    });
    refundsCreate.mockResolvedValue({ id: "re_paynow_1", status: "pending" });

    const res = await handler(makeRequest({ orderId: "11111111-1111-1111-1111-111111111111" }));
    const body = await res.json();

    // This is the exact bug the fix closes: a non-throwing pending
    // response must never be reported (or, upstream, ever have been
    // recorded in the database) as succeeded.
    expect(body.status).toBe("pending");
    expect(body.status).not.toBe("succeeded");
    expect(res.status).toBe(200); // the *request* to start the refund succeeded — the refund itself hasn't
    expect(rpcImpl).toHaveBeenCalledWith(
      "apply_refund_status",
      expect.objectContaining({ p_stripe_status: "pending" })
    );
  });

  it("requires_action is reported distinctly from plain pending", async () => {
    rpcImpl.mockImplementation((name: string) => {
      if (name === "claim_refund_request") return Promise.resolve({ data: claimedRow, error: null });
      if (name === "bind_refund_stripe_id") return Promise.resolve({ data: null, error: null });
      if (name === "apply_refund_status") return Promise.resolve({ data: "applied_requires_action", error: null });
      throw new Error(`unexpected rpc ${name}`);
    });
    refundsCreate.mockResolvedValue({ id: "re_ra_1", status: "requires_action" });

    const res = await handler(makeRequest({ orderId: "11111111-1111-1111-1111-111111111111" }));
    const body = await res.json();

    expect(body.status).toBe("requires_action");
    expect(res.status).toBe(200);
  });

  it("canceled refund is reported as failed with a synthesized reason", async () => {
    rpcImpl.mockImplementation((name: string) => {
      if (name === "claim_refund_request") return Promise.resolve({ data: claimedRow, error: null });
      if (name === "bind_refund_stripe_id") return Promise.resolve({ data: null, error: null });
      if (name === "apply_refund_status") return Promise.resolve({ data: "applied_failed", error: null });
      throw new Error(`unexpected rpc ${name}`);
    });
    refundsCreate.mockResolvedValue({ id: "re_cancel_1", status: "canceled", failure_reason: null });

    const res = await handler(makeRequest({ orderId: "11111111-1111-1111-1111-111111111111" }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.status).toBe("failed");
    expect(body.failureReason).toBe("Refund canceled");
    expect(rpcImpl).toHaveBeenCalledWith(
      "apply_refund_status",
      expect.objectContaining({ p_stripe_status: "canceled", p_failure_reason: "Refund canceled" })
    );
  });

  it("StripeInvalidRequestError: settles failed directly, never calls bind_refund_stripe_id (no Refund object was ever created)", async () => {
    rpcImpl.mockImplementation((name: string) => {
      if (name === "claim_refund_request") return Promise.resolve({ data: claimedRow, error: null });
      if (name === "apply_refund_status") return Promise.resolve({ data: "applied_failed", error: null });
      throw new Error(`unexpected rpc ${name}`);
    });
    const stripeErr = Object.create(Stripe.errors.StripeInvalidRequestError.prototype);
    stripeErr.message = "Charge has already been refunded";
    refundsCreate.mockRejectedValue(stripeErr);

    const res = await handler(makeRequest({ orderId: "11111111-1111-1111-1111-111111111111" }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.status).toBe("failed");
    expect(rpcImpl).toHaveBeenCalledWith(
      "apply_refund_status",
      expect.objectContaining({ p_stripe_status: "failed", p_failure_reason: "Charge has already been refunded" })
    );
    expect(rpcImpl).not.toHaveBeenCalledWith("bind_refund_stripe_id", expect.anything());
  });

  it("ambiguous error (network/5xx): leaves the request exactly as claimed, never calls apply_refund_status", async () => {
    rpcImpl.mockImplementation((name: string) => {
      if (name === "claim_refund_request") return Promise.resolve({ data: claimedRow, error: null });
      throw new Error(`unexpected rpc ${name}`);
    });
    refundsCreate.mockRejectedValue(new Error("ECONNRESET"));

    const res = await handler(makeRequest({ orderId: "11111111-1111-1111-1111-111111111111" }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.code).toBe("refund_outcome_unknown");
    expect(rpcImpl).not.toHaveBeenCalledWith("apply_refund_status", expect.anything());
  });

  it("retry after a crash between refunds.create and bind: bind_refund_stripe_id is called again with the same Stripe refund id, idempotently", async () => {
    rpcImpl.mockImplementation((name: string) => {
      if (name === "claim_refund_request") return Promise.resolve({ data: claimedRow, error: null });
      if (name === "bind_refund_stripe_id") return Promise.resolve({ data: null, error: null }); // idempotent no-op on the DB side
      if (name === "apply_refund_status") return Promise.resolve({ data: "noop_already_succeeded", error: null });
      throw new Error(`unexpected rpc ${name}`);
    });
    fromResolvers.orders = () => ({ data: { stripe_payment_intent_id: "pi_test_123", refunded_cents: 10000, status: "refunded" }, error: null });
    // Same idempotencyKey (claimed.id) means Stripe hands back the *same*
    // already-succeeded Refund object on a retry.
    refundsCreate.mockResolvedValue({ id: "re_retry_1", status: "succeeded" });

    const res = await handler(makeRequest({ orderId: "11111111-1111-1111-1111-111111111111" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("succeeded");
    expect(refundsCreate).toHaveBeenCalledWith(expect.anything(), { idempotencyKey: "req-1" });
  });

  it("finance_readonly is refused before any Stripe call is made", async () => {
    fromResolvers.admin_profiles = () => ({ data: { role: "finance_readonly" }, error: null });

    const res = await handler(makeRequest({ orderId: "11111111-1111-1111-1111-111111111111" }));
    expect(res.status).toBe(403);
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(rpcImpl).not.toHaveBeenCalled();
  });

  it("apply_refund_status reporting mismatch is treated as a server error, not silently accepted", async () => {
    rpcImpl.mockImplementation((name: string) => {
      if (name === "claim_refund_request") return Promise.resolve({ data: claimedRow, error: null });
      if (name === "bind_refund_stripe_id") return Promise.resolve({ data: null, error: null });
      if (name === "apply_refund_status") return Promise.resolve({ data: "mismatch", error: null });
      throw new Error(`unexpected rpc ${name}`);
    });
    refundsCreate.mockResolvedValue({ id: "re_mismatch_1", status: "succeeded" });

    const res = await handler(makeRequest({ orderId: "11111111-1111-1111-1111-111111111111" }));
    expect(res.status).toBe(500);
  });
});

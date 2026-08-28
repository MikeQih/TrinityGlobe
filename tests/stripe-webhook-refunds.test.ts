import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

// handleRefundEvent takes a plain Supabase-shaped object directly (it's an
// exported helper, not the default HTTP handler), so this file mocks only
// the email module — no need to mock ./_lib/supabase or ./_lib/stripe at
// all, since the test builds and passes in its own fake client per test.
// vi.hoisted is required (rather than a plain top-level const) because
// vi.mock's factory below is itself hoisted above normal variable
// declarations — referencing an un-hoisted const from inside it would hit
// the temporal dead zone at import time.
const { sendRefundReviewAlertEmailMock } = vi.hoisted(() => ({
  sendRefundReviewAlertEmailMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../netlify/functions/_lib/email", () => ({
  sendRefundReviewAlertEmail: sendRefundReviewAlertEmailMock,
  // Only imported for handlePaymentSucceeded's path, unused by these
  // tests, but the module must still export them for the import to resolve.
  sendOrderConfirmationEmail: vi.fn(),
  sendStaffNotificationEmail: vi.fn(),
  sendPaymentReviewAlertEmail: vi.fn(),
}));

import { handleRefundEvent } from "../netlify/functions/stripe-webhook";

const ORDER_ID = "22222222-2222-2222-2222-222222222222";
const REQUEST_ID = "33333333-3333-3333-3333-333333333333";

function makeRefund(overrides: Partial<Stripe.Refund> = {}): Stripe.Refund {
  return {
    id: "re_1",
    object: "refund",
    amount: 10000,
    currency: "sgd",
    payment_intent: "pi_test_123",
    status: "succeeded",
    metadata: { refund_request_id: REQUEST_ID, order_id: ORDER_ID },
    failure_reason: null,
    ...overrides,
  } as Stripe.Refund;
}

function makeSupabase(opts: {
  refundRequestRow?: { id: string; order_id: string; amount_cents: number } | null;
  orderRow?: { stripe_payment_intent_id: string | null; currency: string } | null;
  rpcError?: unknown;
}) {
  const rpc = vi.fn().mockResolvedValue({ data: "applied_succeeded", error: opts.rpcError ?? null });
  const from = vi.fn((table: string) => {
    if (table === "refund_requests") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: opts.refundRequestRow ?? null, error: null }),
          }),
        }),
      };
    }
    if (table === "orders") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: opts.orderRow ?? null, error: null }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { from, rpc } as unknown as Parameters<typeof handleRefundEvent>[0];
}

const validRow = { id: REQUEST_ID, order_id: ORDER_ID, amount_cents: 10000 };
const validOrder = { stripe_payment_intent_id: "pi_test_123", currency: "SGD" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("stripe-webhook — handleRefundEvent", () => {
  it("succeeded event with matching order/amount/currency/payment_intent -> apply_refund_status called", async () => {
    const supabase = makeSupabase({ refundRequestRow: validRow, orderRow: validOrder });
    await handleRefundEvent(supabase, makeRefund({ status: "succeeded" }));

    expect(supabase.rpc).toHaveBeenCalledWith(
      "apply_refund_status",
      expect.objectContaining({
        p_refund_request_id: REQUEST_ID,
        p_stripe_status: "succeeded",
        p_stripe_refund_id: "re_1",
        p_expected_order_id: ORDER_ID,
        p_expected_amount_cents: 10000,
      })
    );
    expect(sendRefundReviewAlertEmailMock).not.toHaveBeenCalled();
  });

  it("failed event carries the failure reason through to apply_refund_status", async () => {
    const supabase = makeSupabase({ refundRequestRow: validRow, orderRow: validOrder });
    await handleRefundEvent(supabase, makeRefund({ status: "failed", failure_reason: "expired_or_canceled_card" }));

    expect(supabase.rpc).toHaveBeenCalledWith(
      "apply_refund_status",
      expect.objectContaining({ p_stripe_status: "failed", p_failure_reason: "expired_or_canceled_card" })
    );
  });

  it("amount mismatch: apply_refund_status is never called, and staff are alerted", async () => {
    const supabase = makeSupabase({ refundRequestRow: validRow, orderRow: validOrder });
    await handleRefundEvent(supabase, makeRefund({ amount: 5000 })); // ledger row says 10000

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(sendRefundReviewAlertEmailMock).toHaveBeenCalledWith(
      ORDER_ID,
      "re_1",
      expect.stringContaining("refund.amount=5000")
    );
  });

  it("payment_intent mismatch: apply_refund_status is never called, order left untouched", async () => {
    const supabase = makeSupabase({ refundRequestRow: validRow, orderRow: validOrder });
    await handleRefundEvent(supabase, makeRefund({ payment_intent: "pi_someone_else" }));

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(sendRefundReviewAlertEmailMock).toHaveBeenCalled();
  });

  it("currency mismatch: apply_refund_status is never called", async () => {
    const supabase = makeSupabase({ refundRequestRow: validRow, orderRow: { ...validOrder, currency: "USD" } });
    await handleRefundEvent(supabase, makeRefund({ currency: "sgd" }));

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(sendRefundReviewAlertEmailMock).toHaveBeenCalled();
  });

  it("no matching refund_requests row (metadata and stripe_refund_id both miss): logged, nothing applied, no alert sent", async () => {
    const supabase = makeSupabase({ refundRequestRow: null, orderRow: validOrder });
    await handleRefundEvent(supabase, makeRefund({ metadata: {} }));

    expect(supabase.rpc).not.toHaveBeenCalled();
    // Not this event's job to page anyone — there is nothing in our own
    // ledger to reconcile it against at all, as opposed to a genuine
    // conflict against a row we did find.
    expect(sendRefundReviewAlertEmailMock).not.toHaveBeenCalled();
  });

  it("falls back to matching by stripe_refund_id when metadata is absent", async () => {
    const supabase = makeSupabase({ refundRequestRow: validRow, orderRow: validOrder });
    await handleRefundEvent(supabase, makeRefund({ metadata: {} }));

    expect(supabase.rpc).toHaveBeenCalledWith("apply_refund_status", expect.objectContaining({ p_refund_request_id: REQUEST_ID }));
  });

  it("apply_refund_status RPC error is rethrown so the caller can trigger a Stripe retry", async () => {
    const supabase = makeSupabase({ refundRequestRow: validRow, orderRow: validOrder, rpcError: new Error("db down") });
    await expect(handleRefundEvent(supabase, makeRefund())).rejects.toThrow("db down");
  });
});

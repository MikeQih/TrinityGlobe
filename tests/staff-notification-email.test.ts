import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression coverage for the multi-recipient staff-notification fix.
 *
 * Root cause: sendStaffNotificationEmail/resendStaffNotificationEmail used
 * to join STAFF_NOTIFICATION_EMAILS' parsed list back into a single
 * comma-separated string and pass that as Resend's `to` field. Resend's own
 * API docs only document `to` as `string | string[]` — a single address, or
 * an array for multiple — and never mention a comma-joined string as a
 * supported way to reach more than one address. sendTrackedEmail now takes
 * `to` (what Resend actually receives) separately from `recipient` (the
 * plain-text email_logs ledger column), and staff emails are parsed via the
 * new parseStaffEmails() helper (trim/filter/case-insensitive-dedupe) and
 * passed to Resend as a real array.
 *
 * These tests mock only the two things sendTrackedEmail talks to over the
 * network — the `resend` package and Supabase's claim_email_send/
 * settle_email_send RPCs — and exercise the real, unmocked _lib/email.ts
 * logic in between, so the assertions are against the actual payload this
 * code builds, not a hand-authored stand-in. No real email is ever sent —
 * `resend.emails.send` is a vi.fn() for the whole file.
 */

const { sendMock, rpcMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}));

vi.mock("../netlify/functions/_lib/supabase", () => ({
  getSupabaseAdmin: () => ({ rpc: rpcMock }),
}));

import {
  sendStaffNotificationEmail,
  resendStaffNotificationEmail,
  sendOrderConfirmationEmail,
} from "../netlify/functions/_lib/email";

const ORDER_ID = "11111111-1111-1111-1111-111111111111";

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    recipient_snapshot: {
      name: "Test Customer",
      phone: "+65 9123 4567",
      email: "customer@example.com",
      address: "1 Test Street",
      postalCode: "123456",
      notes: "",
    },
    delivery_method: "standard",
    subtotal_cents: 10000,
    shipping_fee_cents: 1500,
    total_cents: 11500,
    gst_cents: 0,
    gst_registered_at_checkout: false,
    created_at: "2026-08-01T00:00:00Z",
    paid_at: "2026-08-01T00:05:00Z",
    locale: "en",
    ...overrides,
  };
}

const ITEMS = [{ name_snapshot: "Test Product", qty: 1, line_total_cents: 10000 }];

let claimCallCount = 0;

beforeEach(() => {
  vi.clearAllMocks();
  claimCallCount = 0;
  process.env.RESEND_API_KEY = "test-resend-key";
  delete process.env.STAFF_NOTIFICATION_EMAILS;

  rpcMock.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === "claim_email_send") {
      claimCallCount += 1;
      return Promise.resolve({
        data: {
          id: `email-log-${claimCallCount}`,
          order_id: args.p_order_id,
          email_type: args.p_email_type,
          recipient: args.p_recipient,
          status: "pending",
        },
        error: null,
      });
    }
    if (name === "settle_email_send") {
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });

  sendMock.mockResolvedValue({ data: { id: "resend-email-id-1" }, error: null });
});

describe("staff notification: multi-recipient Resend payload", () => {
  it("single staff email produces a one-element `to` array", async () => {
    process.env.STAFF_NOTIFICATION_EMAILS = "staff@example.com";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendStaffNotificationEmail(makeOrder() as any, ITEMS as any);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0]![0];
    expect(payload.to).toEqual(["staff@example.com"]);
    expect(Array.isArray(payload.to)).toBe(true);
  });

  it("two staff emails produce two independent `to` array elements", async () => {
    process.env.STAFF_NOTIFICATION_EMAILS = "a@example.com,b@example.com";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendStaffNotificationEmail(makeOrder() as any, ITEMS as any);

    const payload = sendMock.mock.calls[0]![0];
    expect(payload.to).toEqual(["a@example.com", "b@example.com"]);
  });

  it("surrounding whitespace around each address is trimmed", async () => {
    process.env.STAFF_NOTIFICATION_EMAILS = "  a@example.com  ,  b@example.com  ";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendStaffNotificationEmail(makeOrder() as any, ITEMS as any);

    const payload = sendMock.mock.calls[0]![0];
    expect(payload.to).toEqual(["a@example.com", "b@example.com"]);
  });

  it("empty segments (double commas / trailing comma) are filtered out", async () => {
    process.env.STAFF_NOTIFICATION_EMAILS = "a@example.com,,  ,b@example.com,";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendStaffNotificationEmail(makeOrder() as any, ITEMS as any);

    const payload = sendMock.mock.calls[0]![0];
    expect(payload.to).toEqual(["a@example.com", "b@example.com"]);
  });

  it("duplicate addresses are de-duplicated case-insensitively, keeping first-seen casing", async () => {
    process.env.STAFF_NOTIFICATION_EMAILS = "a@example.com,A@EXAMPLE.com,b@example.com,a@example.com";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendStaffNotificationEmail(makeOrder() as any, ITEMS as any);

    const payload = sendMock.mock.calls[0]![0];
    expect(payload.to).toEqual(["a@example.com", "b@example.com"]);
  });

  it("an empty/unset list fails safely — Resend and the ledger are never touched", async () => {
    process.env.STAFF_NOTIFICATION_EMAILS = "   ,  ,";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendStaffNotificationEmail(makeOrder() as any, ITEMS as any);

    expect(sendMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("customer_confirmation is unaffected — still sent only to the customer's own email as a plain string", async () => {
    process.env.STAFF_NOTIFICATION_EMAILS = "a@example.com,b@example.com";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendOrderConfirmationEmail(makeOrder() as any, ITEMS as any);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0]![0];
    expect(payload.to).toBe("customer@example.com");
    expect(Array.isArray(payload.to)).toBe(false);

    const claimArgs = rpcMock.mock.calls.find((c) => c[0] === "claim_email_send")?.[1];
    expect(claimArgs?.p_email_type).toBe("customer_confirmation");
    expect(claimArgs?.p_recipient).toBe("customer@example.com");
  });

  it("the staff resend path (admin-app) builds the same array-shaped `to` as the automatic send", async () => {
    process.env.STAFF_NOTIFICATION_EMAILS = "a@example.com,b@example.com";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await resendStaffNotificationEmail(makeOrder() as any, ITEMS as any, "staff-user-1");

    const payload = sendMock.mock.calls[0]![0];
    expect(payload.to).toEqual(["a@example.com", "b@example.com"]);

    const claimArgs = rpcMock.mock.calls.find((c) => c[0] === "claim_email_send")?.[1];
    expect(claimArgs?.p_email_type).toBe("staff_notification");
    expect(claimArgs?.p_force_new).toBe(true);
    expect(claimArgs?.p_created_by).toBe("staff-user-1");
    // The ledger's plain-text column still gets a human-readable joined
    // string — only Resend's own `to` field needed to become an array.
    expect(claimArgs?.p_recipient).toBe("a@example.com, b@example.com");
  });

  it("a multi-recipient staff notification still produces exactly one email_logs row, not one per address", async () => {
    process.env.STAFF_NOTIFICATION_EMAILS = "a@example.com,b@example.com,c@example.com";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendStaffNotificationEmail(makeOrder() as any, ITEMS as any);

    const claimCalls = rpcMock.mock.calls.filter((c) => c[0] === "claim_email_send");
    const settleCalls = rpcMock.mock.calls.filter((c) => c[0] === "settle_email_send");
    expect(claimCalls).toHaveLength(1);
    expect(settleCalls).toHaveLength(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("Resend's idempotency key and the webhook's resend_email_id linkage are unchanged", async () => {
    process.env.STAFF_NOTIFICATION_EMAILS = "a@example.com,b@example.com";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendStaffNotificationEmail(makeOrder() as any, ITEMS as any);

    // claim_email_send's mocked id (see beforeEach) is deterministic —
    // "email-log-1" for this test's one and only claim call.
    const sendOptions = sendMock.mock.calls[0]![1];
    expect(sendOptions).toEqual({ idempotencyKey: "email-log-1" });

    const settleArgs = rpcMock.mock.calls.find((c) => c[0] === "settle_email_send")?.[1] as Record<string, unknown>;
    expect(settleArgs.p_outcome).toBe("accepted");
    expect(settleArgs.p_email_log_id).toBe("email-log-1");
    expect(settleArgs.p_resend_email_id).toBe("resend-email-id-1");
  });
});

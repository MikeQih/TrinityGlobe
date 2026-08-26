import { Resend } from "resend";
import { requireEnv } from "./env";
import { getSupabaseAdmin } from "./supabase";

interface RecipientSnapshot {
  name: string;
  phone: string;
  email: string;
  address: string;
  postalCode: string;
  notes: string;
}

interface OrderForEmail {
  id: string;
  recipient_snapshot: RecipientSnapshot;
  delivery_method: string;
  subtotal_cents: number;
  shipping_fee_cents: number;
  total_cents: number;
  gst_cents: number;
  // Snapshotted at checkout — whether GST applied to *this* order,
  // independent of the store's current registration status. Only ever
  // shown when true, never as a "GST: S$0.00" line implying tax was
  // collected when it wasn't. See 0017_gst_registration_effective_date.sql.
  gst_registered_at_checkout: boolean;
}

interface OrderItemForEmail {
  name_snapshot: string;
  qty: number;
  line_total_cents: number;
}

type EmailType = "customer_confirmation" | "staff_notification";

/**
 * Outcome of one tracked send attempt, mirroring settle_email_send's
 * p_outcome values plus a third case (the claim/send never got far enough
 * to settle either way — a database or network error before or during the
 * attempt, logged and left at 'pending' for a future retry to resume).
 */
type SendOutcome = "accepted" | "failed" | "error";

// Error names from the Resend SDK (see node_modules/resend/dist/index.d.ts's
// RESEND_ERROR_CODES_BY_KEY) that mean "this exact request will never
// succeed no matter how many times it's retried" — a malformed address, a
// field that's actually missing, etc. Everything else (rate limits,
// concurrent-idempotent-request conflicts, auth/key problems, Resend's own
// 5xx) is either transient or an environment problem that retrying the
// same claimed attempt later is the right response to, per Resend's own
// idempotency-key guidance — see settle_email_send's comment in
// 0019_email_delivery_tracking.sql for why only this list settles as
// 'failed' and nothing else does.
const PERMANENT_FAILURE_ERROR_NAMES = new Set([
  "missing_required_field",
  "invalid_parameter",
  "invalid_region",
  "invalid_from_address",
  "validation_error",
  "invalid_access",
]);

function fmt(cents: number): string {
  return "S$" + (cents / 100).toFixed(2);
}

function itemsHtml(items: OrderItemForEmail[]): string {
  return items
    .map(
      (i) =>
        `<tr><td style="padding:4px 12px 4px 0;">${escapeHtml(i.name_snapshot)}</td><td style="padding:4px 12px;">x${i.qty}</td><td style="padding:4px 0;text-align:right;">${fmt(i.line_total_cents)}</td></tr>`
    )
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL || "orders@trinityglobe.sg";
}

// Self-collection is paused at checkout (see src/feature-flags.ts) — the
// backend already refuses a self_collection order before this ever runs,
// so this only exists for the "standard" case in practice today. No
// address is hardcoded here even for self_collection: keep in sync with
// policies/delivery.html section 3 once a real collection point exists.
function deliveryDetailsHtml(deliveryMethod: string): string {
  if (deliveryMethod === "self_collection") {
    return `<p>We'll message you once your order is ready for collection — please wait for that notice.</p>`;
  }
  return `<p>We'll be in touch with delivery details shortly.</p>`;
}

function footerHtml(): string {
  return `<p style="color:#999;font-size:12px;margin-top:24px;">Trinity Globe Trading Pte. Ltd. &middot; UEN 202509360N</p>`;
}

/**
 * Claims a tracked send attempt (or resumes an already-claimed one), sends
 * through Resend using the claimed row's own id as the Idempotency-Key,
 * and records the outcome. Never throws — a flaky email provider, or even
 * a broken email_logs table, must not be able to fail order creation,
 * payment confirmation, or a Stripe webhook's response. Every failure mode
 * here ends in a `console.error` and a plain return, same discipline the
 * pre-tracking version of this file already had.
 *
 * forceNew=true (admin-app resends) always claims a brand new attempt —
 * see claim_email_send's comment for why a resend must never resume
 * whatever attempt is currently sitting there, which might already be
 * 'delivered'.
 */
async function sendTrackedEmail(params: {
  orderId: string;
  emailType: EmailType;
  recipient: string;
  createdBy?: string | null;
  forceNew?: boolean;
  buildHtml: () => { subject: string; html: string };
}): Promise<{ outcome: SendOutcome; emailLogId?: string }> {
  const supabase = getSupabaseAdmin();

  const { data: claimed, error: claimError } = await supabase.rpc("claim_email_send", {
    p_order_id: params.orderId,
    p_email_type: params.emailType,
    p_recipient: params.recipient,
    p_created_by: params.createdBy ?? null,
    p_force_new: params.forceNew ?? false,
  });
  if (claimError || !claimed) {
    console.error("sendTrackedEmail: claim_email_send failed", params.orderId, params.emailType, claimError);
    return { outcome: "error" };
  }

  const { subject, html } = params.buildHtml();

  try {
    const resend = new Resend(requireEnv("RESEND_API_KEY"));
    const result = await resend.emails.send(
      { from: fromAddress(), to: params.recipient, subject, html },
      { idempotencyKey: claimed.id }
    );

    if (result.error) {
      const isPermanent = PERMANENT_FAILURE_ERROR_NAMES.has(result.error.name);
      console.error("sendTrackedEmail: Resend returned an error", params.orderId, params.emailType, result.error);
      if (isPermanent) {
        await supabase.rpc("settle_email_send", {
          p_email_log_id: claimed.id,
          p_outcome: "failed",
          p_failure_reason: `${result.error.name}: ${result.error.message}`,
        });
        return { outcome: "failed", emailLogId: claimed.id };
      }
      // Ambiguous/transient — leave the row 'pending' so a retry (automatic
      // or a staff resend) reuses this same id as the idempotency key,
      // per Resend's own retry guidance.
      return { outcome: "error", emailLogId: claimed.id };
    }

    await supabase.rpc("settle_email_send", {
      p_email_log_id: claimed.id,
      p_outcome: "accepted",
      p_resend_email_id: result.data.id,
    });
    return { outcome: "accepted", emailLogId: claimed.id };
  } catch (err) {
    // A network-level failure before any response came back at all — the
    // textbook "outcome unknown" case Resend's idempotency keys exist for.
    // Leave the row 'pending', do not settle it as failed.
    console.error("sendTrackedEmail: send threw", params.orderId, params.emailType, err);
    return { outcome: "error", emailLogId: claimed.id };
  }
}

/** Failures are logged, never thrown — a flaky email provider must not fail order creation/confirmation. */
export async function sendOrderConfirmationEmail(order: OrderForEmail, items: OrderItemForEmail[]): Promise<void> {
  await sendTrackedEmail({
    orderId: order.id,
    emailType: "customer_confirmation",
    recipient: order.recipient_snapshot.email,
    buildHtml: () => ({
      subject: `Trinity Globe — Order Confirmation #${order.id.slice(0, 8)}`,
      html: `
        <h1 style="font-family:serif;">Thank you for your order</h1>
        <p>Order <strong>#${order.id.slice(0, 8)}</strong></p>
        <table style="border-collapse:collapse;width:100%;max-width:480px;">${itemsHtml(items)}</table>
        <p>Subtotal: ${fmt(order.subtotal_cents)}</p>
        <p>Shipping: ${order.shipping_fee_cents === 0 ? "Free" : fmt(order.shipping_fee_cents)}</p>
        <p><strong>Total: ${fmt(order.total_cents)}</strong></p>
        ${order.gst_registered_at_checkout ? `<p style="color:#999;font-size:12px;">Includes GST: ${fmt(order.gst_cents)}</p>` : ""}
        ${deliveryDetailsHtml(order.delivery_method)}
        ${footerHtml()}
      `,
    }),
  });
}

/**
 * Staff-initiated resend from admin-app — always a new tracked attempt
 * (see forceNew's doc comment on sendTrackedEmail/claim_email_send).
 */
export async function resendOrderConfirmationEmail(
  order: OrderForEmail,
  items: OrderItemForEmail[],
  staffUserId: string
): Promise<{ outcome: SendOutcome }> {
  return sendTrackedEmail({
    orderId: order.id,
    emailType: "customer_confirmation",
    recipient: order.recipient_snapshot.email,
    createdBy: staffUserId,
    forceNew: true,
    buildHtml: () => ({
      subject: `Trinity Globe — Order Confirmation #${order.id.slice(0, 8)}`,
      html: `
        <h1 style="font-family:serif;">Thank you for your order</h1>
        <p>Order <strong>#${order.id.slice(0, 8)}</strong></p>
        <table style="border-collapse:collapse;width:100%;max-width:480px;">${itemsHtml(items)}</table>
        <p>Subtotal: ${fmt(order.subtotal_cents)}</p>
        <p>Shipping: ${order.shipping_fee_cents === 0 ? "Free" : fmt(order.shipping_fee_cents)}</p>
        <p><strong>Total: ${fmt(order.total_cents)}</strong></p>
        ${order.gst_registered_at_checkout ? `<p style="color:#999;font-size:12px;">Includes GST: ${fmt(order.gst_cents)}</p>` : ""}
        ${deliveryDetailsHtml(order.delivery_method)}
        ${footerHtml()}
      `,
    }),
  });
}

/**
 * Fires when stripe-webhook.ts's mark_order_paid_from_webhook RPC returns
 * 'payment_review' (Stripe reports success on an order that wasn't sitting
 * at pending_payment anymore) or when its own amount/currency check fails —
 * both cases where Stripe has genuinely taken the customer's money but the
 * order can't be safely auto-confirmed. See 0008_checkout_hardening.sql for
 * why neither confirming nor ignoring it automatically is safe. Same
 * failed-is-logged-not-thrown rule as the other email functions here — a
 * flaky Resend call must never take down webhook processing.
 *
 * Deliberately not part of the email_logs tracking ledger — this is a rare
 * ops alert to a fixed internal address list, not one of the two routine
 * per-order emails the ledger is built to answer "did the customer/staff
 * actually get their email" for. A missed payment_review alert is already
 * visible in admin-app as the order itself sitting in payment_review.
 */
export async function sendPaymentReviewAlertEmail(orderId: string, reason: string): Promise<void> {
  const staffEmails = (process.env.STAFF_NOTIFICATION_EMAILS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (staffEmails.length === 0) return;

  try {
    const resend = new Resend(requireEnv("RESEND_API_KEY"));
    await resend.emails.send({
      from: fromAddress(),
      to: staffEmails,
      subject: `⚠️ Order #${orderId.slice(0, 8)} needs manual review — payment received`,
      html: `
        <h1 style="font-family:serif;color:#b00;">Payment review needed</h1>
        <p>Order <strong>#${orderId.slice(0, 8)}</strong> — Stripe reported a successful payment for this order,
        but it couldn't be automatically confirmed.</p>
        <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
        <p>Check this order in admin-app before fulfilling it — confirm with Stripe's dashboard whether the
        charge really went through and whether the stock is still available, then either confirm or refund it
        manually.</p>
      `,
    });
  } catch (err) {
    console.error("sendPaymentReviewAlertEmail failed", orderId, err);
  }
}

export async function sendStaffNotificationEmail(order: OrderForEmail, items: OrderItemForEmail[]): Promise<void> {
  const staffEmails = (process.env.STAFF_NOTIFICATION_EMAILS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (staffEmails.length === 0) return;

  await sendTrackedEmail({
    orderId: order.id,
    emailType: "staff_notification",
    recipient: staffEmails.join(", "),
    buildHtml: () => {
      const r = order.recipient_snapshot;
      return {
        subject: `New order #${order.id.slice(0, 8)} — ${fmt(order.total_cents)}`,
        html: `
          <h1 style="font-family:serif;">New paid order</h1>
          <p>Order <strong>#${order.id.slice(0, 8)}</strong></p>
          <p>${escapeHtml(r.name)} &middot; ${escapeHtml(r.phone)} &middot; ${escapeHtml(r.email)}</p>
          <p>Delivery: ${order.delivery_method}${r.address ? " — " + escapeHtml(r.address) + " " + escapeHtml(r.postalCode) : ""}</p>
          ${r.notes ? `<p>Notes: ${escapeHtml(r.notes)}</p>` : ""}
          <table style="border-collapse:collapse;width:100%;max-width:480px;">${itemsHtml(items)}</table>
          <p><strong>Total: ${fmt(order.total_cents)}</strong></p>
        `,
      };
    },
  });
}

/**
 * Staff-initiated resend of the internal notification — same forceNew
 * reasoning as resendOrderConfirmationEmail.
 */
export async function resendStaffNotificationEmail(
  order: OrderForEmail,
  items: OrderItemForEmail[],
  staffUserId: string
): Promise<{ outcome: SendOutcome } | null> {
  const staffEmails = (process.env.STAFF_NOTIFICATION_EMAILS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (staffEmails.length === 0) return null;

  return sendTrackedEmail({
    orderId: order.id,
    emailType: "staff_notification",
    recipient: staffEmails.join(", "),
    createdBy: staffUserId,
    forceNew: true,
    buildHtml: () => {
      const r = order.recipient_snapshot;
      return {
        subject: `New order #${order.id.slice(0, 8)} — ${fmt(order.total_cents)}`,
        html: `
          <h1 style="font-family:serif;">New paid order</h1>
          <p>Order <strong>#${order.id.slice(0, 8)}</strong></p>
          <p>${escapeHtml(r.name)} &middot; ${escapeHtml(r.phone)} &middot; ${escapeHtml(r.email)}</p>
          <p>Delivery: ${order.delivery_method}${r.address ? " — " + escapeHtml(r.address) + " " + escapeHtml(r.postalCode) : ""}</p>
          ${r.notes ? `<p>Notes: ${escapeHtml(r.notes)}</p>` : ""}
          <table style="border-collapse:collapse;width:100%;max-width:480px;">${itemsHtml(items)}</table>
          <p><strong>Total: ${fmt(order.total_cents)}</strong></p>
        `,
      };
    },
  });
}

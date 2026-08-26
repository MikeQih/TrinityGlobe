import { Resend } from "resend";
import { requireEnv } from "./env";

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
}

interface OrderItemForEmail {
  name_snapshot: string;
  qty: number;
  line_total_cents: number;
}

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

/** Failures are logged, never thrown — a flaky email provider must not fail order creation/confirmation. */
export async function sendOrderConfirmationEmail(order: OrderForEmail, items: OrderItemForEmail[]): Promise<void> {
  try {
    const resend = new Resend(requireEnv("RESEND_API_KEY"));
    await resend.emails.send({
      from: fromAddress(),
      to: order.recipient_snapshot.email,
      subject: `Trinity Globe — Order Confirmation #${order.id.slice(0, 8)}`,
      html: `
        <h1 style="font-family:serif;">Thank you for your order</h1>
        <p>Order <strong>#${order.id.slice(0, 8)}</strong></p>
        <table style="border-collapse:collapse;width:100%;max-width:480px;">${itemsHtml(items)}</table>
        <p>Subtotal: ${fmt(order.subtotal_cents)}</p>
        <p>Shipping: ${order.shipping_fee_cents === 0 ? "Free" : fmt(order.shipping_fee_cents)}</p>
        <p><strong>Total: ${fmt(order.total_cents)}</strong></p>
        ${deliveryDetailsHtml(order.delivery_method)}
        ${footerHtml()}
      `,
    });
  } catch (err) {
    console.error("sendOrderConfirmationEmail failed", order.id, err);
  }
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

  try {
    const resend = new Resend(requireEnv("RESEND_API_KEY"));
    const r = order.recipient_snapshot;
    await resend.emails.send({
      from: fromAddress(),
      to: staffEmails,
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
    });
  } catch (err) {
    console.error("sendStaffNotificationEmail failed", order.id, err);
  }
}

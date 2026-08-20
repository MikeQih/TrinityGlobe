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

// The checkout page deliberately doesn't show this address up front (see
// src/cart.ts's checkout-self-collection-info copy) — it promises the
// details will follow by email/phone instead. This is where that promise
// is kept. Keep in sync with policies/delivery.html section 3.
function deliveryDetailsHtml(deliveryMethod: string): string {
  if (deliveryMethod === "self_collection") {
    return `
      <p><strong>Self collection</strong></p>
      <p>11-03, The Suites Central, 57A Devonshire Road, Singapore 239897<br />
      Available 24 hours<br />
      Contact on collection: WANGLEI, +65 9868 0555</p>
      <p>We'll message you once your order is ready — please wait for that notice before coming down.</p>
    `;
  }
  return `<p>We'll be in touch with delivery details shortly.</p>`;
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
      `,
    });
  } catch (err) {
    console.error("sendOrderConfirmationEmail failed", order.id, err);
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

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
  // Only used to render "ordered on" — never used for any business logic
  // here. paid_at is preferred when present (this email only ever fires
  // once payment is confirmed); created_at is the fallback.
  created_at?: string | null;
  paid_at?: string | null;
  // Snapshotted once by create_pending_order at checkout time (see
  // 0021_order_locale_snapshot.sql) — the sole authority for which
  // language the *customer* confirmation email goes out in. Re-validated
  // below rather than trusted as-is, since the column, while constrained
  // by a CHECK, is still just a string by the time it gets here.
  locale?: string | null;
}

interface OrderItemForEmail {
  name_snapshot: string;
  qty: number;
  line_total_cents: number;
}

type EmailType = "customer_confirmation" | "staff_notification";

type Lang = "en" | "zh";

/**
 * The customer confirmation email's language is always derived from the
 * order's own `locale` column (see 0021_order_locale_snapshot.sql) — never
 * passed in by a caller, never re-read from Stripe metadata, and never
 * affected by the site's language toggle or an admin's own language when
 * they trigger a resend. Anything other than exactly "en"/"zh" (missing,
 * null, or some future unexpected value) falls back to "en" rather than
 * failing the send.
 */
function resolveOrderLocale(locale: string | null | undefined): Lang {
  return locale === "zh" ? "zh" : "en";
}

const WHATSAPP_URL = "https://wa.me/6598680555";

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

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL || "orders@trinityglobe.sg";
}

// Same fallback convention as fromAddress() above — email rendering must
// never throw just because an env var is momentarily unset, since a thrown
// buildHtml() would surface as a rejected promise all the way out of
// sendOrderConfirmationEmail/sendStaffNotificationEmail (see stripe-
// webhook.ts's Promise.allSettled, which tolerates that, but there's no
// reason to make a cosmetic link the thing that breaks the whole email).
function siteUrl(): string {
  return (process.env.SITE_URL || "https://trinityglobe.sg").replace(/\/$/, "");
}

// Same project as ADMIN_APP_ORIGIN, already required for admin-refund-
// order's CORS headers (see _lib/cors.ts) — reused here rather than adding
// a new env var. Optional: if unset, the staff email simply omits the
// "View in admin-app" button instead of linking to nothing.
function adminAppOrigin(): string | undefined {
  const v = process.env.ADMIN_APP_ORIGIN;
  return v ? v.replace(/\/$/, "") : undefined;
}

function formatOrderTime(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-SG" : "en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

interface EmailStrings {
  confirmationSubject: string;
  confirmationPreheader: string;
  confirmationHeading: string;
  confirmationIntro: string;
  orderNumber: string;
  orderedOn: string;
  itemsHeading: string;
  qty: string;
  subtotal: string;
  shipping: string;
  free: string;
  gst: string;
  total: string;
  deliveryHeading: string;
  recipient: string;
  phone: string;
  deliveryStandardNotice: string;
  deliverySelfCollectionNotice: string;
  ageNotice: string;
  viewOrderBtn: string;
  whatsappBtn: string;
  footerCompany: string;
  staffSubjectPrefix: string;
  staffHeading: string;
  staffPaymentStatus: string;
  staffPaid: string;
  staffDeliveryMethod: string;
  staffOrderedOn: string;
  staffCustomer: string;
  staffAddress: string;
  staffNoAddress: string;
  staffNotes: string;
  staffAmounts: string;
  staffViewInAdminBtn: string;
  deliveryMethodStandard: string;
  deliveryMethodSelfCollection: string;
}

const STR: Record<Lang, EmailStrings> = {
  en: {
    confirmationSubject: "Trinity Globe — Order Confirmation",
    confirmationPreheader: "Your payment is confirmed and we're preparing your order.",
    confirmationHeading: "Your order is confirmed",
    confirmationIntro: "Thank you — we've received your payment and your order is now being prepared.",
    orderNumber: "Order",
    orderedOn: "Ordered on",
    itemsHeading: "Items",
    qty: "Qty",
    subtotal: "Subtotal",
    shipping: "Shipping",
    free: "Free",
    gst: "GST (included)",
    total: "Total",
    deliveryHeading: "Delivery details",
    recipient: "Recipient",
    phone: "Phone",
    deliveryStandardNotice:
      "Estimated delivery: 1–2 business days. Delivery times are estimates, not guarantees, and may be affected by public holidays, weather, or order volume.",
    deliverySelfCollectionNotice:
      "We'll message you with the collection address, hours, and pickup instructions shortly — please wait for that notice before coming down.",
    ageNotice:
      "As this order contains alcohol, whoever receives it at the door must be 18 or older and may be asked to show ID. We reserve the right to refuse handover if age can't be verified.",
    viewOrderBtn: "View Order",
    whatsappBtn: "Chat with us on WhatsApp",
    footerCompany: "Trinity Globe Trading Pte. Ltd.",
    staffSubjectPrefix: "New paid order／新已付款订单",
    staffHeading: "New paid order",
    staffPaymentStatus: "Payment status",
    staffPaid: "Paid",
    staffDeliveryMethod: "Delivery method",
    staffOrderedOn: "Order time",
    staffCustomer: "Customer",
    staffAddress: "Delivery address",
    staffNoAddress: "— (self collection)",
    staffNotes: "Customer notes",
    staffAmounts: "Amounts",
    staffViewInAdminBtn: "View in admin-app",
    deliveryMethodStandard: "Standard delivery",
    deliveryMethodSelfCollection: "Self collection",
  },
  zh: {
    confirmationSubject: "Trinity Globe — 订单确认",
    confirmationPreheader: "您的付款已确认，我们正在为您准备订单。",
    confirmationHeading: "您的订单已确认",
    confirmationIntro: "感谢您的订购——我们已收到您的付款，订单正在准备中。",
    orderNumber: "订单号",
    orderedOn: "下单时间",
    itemsHeading: "商品明细",
    qty: "数量",
    subtotal: "小计",
    shipping: "运费",
    free: "免费",
    gst: "消费税(GST)（已含）",
    total: "总计",
    deliveryHeading: "配送信息",
    recipient: "收件人",
    phone: "电话",
    deliveryStandardNotice: "预计配送时间：1–2 个工作日。配送时间仅为预估，不作为保证，可能因公共假期、天气或订单量较大而受到影响。",
    deliverySelfCollectionNotice: "我们会尽快将自提地址、开放时间和取货说明发送给您，请等待通知后再前来取货。",
    ageNotice: "由于本订单含酒类商品，在门口签收订单的人员必须年满18周岁，我们可能会要求其出示身份证件。如无法核实年龄，我们保留拒绝交付的权利。",
    viewOrderBtn: "查看订单",
    whatsappBtn: "通过 WhatsApp 联系我们",
    footerCompany: "Trinity Globe Trading Pte. Ltd.",
    staffSubjectPrefix: "New paid order／新已付款订单",
    staffHeading: "新的已付款订单",
    staffPaymentStatus: "付款状态",
    staffPaid: "已付款",
    staffDeliveryMethod: "配送方式",
    staffOrderedOn: "下单时间",
    staffCustomer: "客户信息",
    staffAddress: "配送地址",
    staffNoAddress: "— （自提）",
    staffNotes: "客户备注",
    staffAmounts: "金额明细",
    staffViewInAdminBtn: "在后台查看",
    deliveryMethodStandard: "标准配送",
    deliveryMethodSelfCollection: "自提",
  },
};

/**
 * Shared bulletproof-ish email shell: fluid single-column table capped at
 * 600px, no @media queries needed (email clients strip <style> blocks
 * unpredictably — a liquid percentage-width table degrades to any width
 * from 320px up without one). Black header / white body / dark-gold accent,
 * text-based wordmark since there's no email-safe logo asset in this repo
 * (an inline <img> would need a stable, publicly-hosted, absolute URL —
 * introducing one is out of scope for this round; text degrades cleanly in
 * every client instead of risking a broken-image icon).
 */
function emailShell(opts: { lang: Lang; preheader: string; bodyHtml: string }): string {
  return `<!doctype html>
<html lang="${opts.lang === "zh" ? "zh-CN" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Trinity Globe</title>
</head>
<body style="margin:0;padding:0;background:#f4f1ea;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f1ea;">${escapeHtml(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f1ea;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;">
<tr>
<td style="background:#0a0a0a;padding:28px 24px;text-align:center;">
<span style="font-family:Georgia,'Times New Roman',serif;font-size:22px;letter-spacing:5px;color:#c9a44c;">TRINITY GLOBE</span>
</td>
</tr>
<tr>
<td style="padding:32px 24px;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
${opts.bodyHtml}
</td>
</tr>
<tr>
<td style="background:#faf9f6;padding:20px 24px;text-align:center;border-top:1px solid #ececec;font-family:Arial,Helvetica,sans-serif;">
<p style="margin:0;color:#999999;font-size:12px;">${escapeHtml(STR[opts.lang].footerCompany)} &middot; UEN 202509360N</p>
</td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function buttonHtml(label: string, href: string, variant: "gold" | "dark" = "gold"): string {
  const bg = variant === "gold" ? "#c9a44c" : "#0a0a0a";
  const color = variant === "gold" ? "#0a0a0a" : "#ffffff";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 8px 8px 0;display:inline-block;">
<tr><td style="background:${bg};border-radius:2px;">
<a href="${href}" style="display:inline-block;padding:12px 22px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:1px;color:${color};text-decoration:none;">${escapeHtml(label)}</a>
</td></tr>
</table>`;
}

function itemsTableHtml(items: OrderItemForEmail[], lang: Lang): string {
  const rows = items
    .map(
      (i) => `<tr>
<td style="padding:10px 0;border-bottom:1px solid #ececec;font-size:14px;color:#1a1a1a;">${escapeHtml(
        i.name_snapshot
      )}<br><span style="color:#999999;font-size:12px;">${escapeHtml(STR[lang].qty)}: ${i.qty}</span></td>
<td style="padding:10px 0;border-bottom:1px solid #ececec;font-size:14px;color:#1a1a1a;text-align:right;white-space:nowrap;">${fmt(
        i.line_total_cents
      )}</td>
</tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
}

function totalsTableHtml(order: OrderForEmail, lang: Lang): string {
  const s = STR[lang];
  const rows = [
    `<tr><td style="padding:4px 0;font-size:13px;color:#666666;">${escapeHtml(s.subtotal)}</td><td style="padding:4px 0;font-size:13px;color:#666666;text-align:right;">${fmt(
      order.subtotal_cents
    )}</td></tr>`,
    `<tr><td style="padding:4px 0;font-size:13px;color:#666666;">${escapeHtml(s.shipping)}</td><td style="padding:4px 0;font-size:13px;color:#666666;text-align:right;">${
      order.shipping_fee_cents === 0 ? escapeHtml(s.free) : fmt(order.shipping_fee_cents)
    }</td></tr>`,
  ];
  if (order.gst_registered_at_checkout) {
    rows.push(
      `<tr><td style="padding:4px 0;font-size:12px;color:#999999;">${escapeHtml(s.gst)}</td><td style="padding:4px 0;font-size:12px;color:#999999;text-align:right;">${fmt(
        order.gst_cents
      )}</td></tr>`
    );
  }
  rows.push(
    `<tr><td style="padding:10px 0 0;font-size:16px;font-weight:bold;color:#1a1a1a;border-top:1px solid #ececec;">${escapeHtml(
      s.total
    )}</td><td style="padding:10px 0 0;font-size:16px;font-weight:bold;color:#1a1a1a;text-align:right;border-top:1px solid #ececec;">${fmt(
      order.total_cents
    )}</td></tr>`
  );
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table>`;
}

function deliveryNoticeHtml(deliveryMethod: string, lang: Lang): string {
  const s = STR[lang];
  const notice = deliveryMethod === "self_collection" ? s.deliverySelfCollectionNotice : s.deliveryStandardNotice;
  return `<p style="font-size:13px;color:#666666;line-height:1.6;margin:0 0 10px;">${escapeHtml(notice)}</p>
<p style="font-size:12px;color:#999999;line-height:1.6;margin:0;">${escapeHtml(s.ageNotice)}</p>`;
}

function customerConfirmationHtml(order: OrderForEmail, items: OrderItemForEmail[], lang: Lang): string {
  const s = STR[lang];
  const r = order.recipient_snapshot;
  const orderTime = formatOrderTime(order.paid_at ?? order.created_at, lang);
  const deliveryMethodLabel = order.delivery_method === "self_collection" ? s.deliveryMethodSelfCollection : s.deliveryMethodStandard;

  const body = `
<h1 style="font-family:Georgia,'Times New Roman',serif;font-size:22px;margin:0 0 8px;color:#1a1a1a;">${escapeHtml(
    s.confirmationHeading
  )}</h1>
<p style="font-size:14px;color:#444444;line-height:1.6;margin:0 0 20px;">${escapeHtml(s.confirmationIntro)}</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
<tr>
<td style="font-size:13px;color:#999999;">${escapeHtml(s.orderNumber)}</td>
<td style="font-size:13px;color:#1a1a1a;font-weight:bold;text-align:right;">#${escapeHtml(order.id.slice(0, 8))}</td>
</tr>
${
  orderTime
    ? `<tr><td style="font-size:13px;color:#999999;padding-top:4px;">${escapeHtml(s.orderedOn)}</td><td style="font-size:13px;color:#1a1a1a;text-align:right;padding-top:4px;">${escapeHtml(
        orderTime
      )}</td></tr>`
    : ""
}
</table>

<h2 style="font-size:14px;color:#1a1a1a;margin:0 0 8px;letter-spacing:0.5px;">${escapeHtml(s.itemsHeading)}</h2>
${itemsTableHtml(items, lang)}
<div style="height:16px;"></div>
${totalsTableHtml(order, lang)}

<div style="height:28px;"></div>
<h2 style="font-size:14px;color:#1a1a1a;margin:0 0 8px;letter-spacing:0.5px;">${escapeHtml(s.deliveryHeading)}</h2>
<p style="font-size:13px;color:#444444;line-height:1.7;margin:0 0 12px;">
${escapeHtml(s.recipient)}: <strong>${escapeHtml(r.name)}</strong><br>
${escapeHtml(s.phone)}: ${escapeHtml(r.phone)}<br>
${
  order.delivery_method === "self_collection"
    ? ""
    : `${escapeHtml(r.address)}${r.postalCode ? ", " + escapeHtml(r.postalCode) : ""}<br>`
}
${escapeHtml(deliveryMethodLabel)}
</p>
${deliveryNoticeHtml(order.delivery_method, lang)}

<div style="height:28px;"></div>
${buttonHtml(s.viewOrderBtn, `${siteUrl()}/orders.html`, "gold")}
${buttonHtml(s.whatsappBtn, WHATSAPP_URL, "dark")}
`;

  return emailShell({ lang, preheader: s.confirmationPreheader, bodyHtml: body });
}

function customerConfirmationText(order: OrderForEmail, items: OrderItemForEmail[], lang: Lang): string {
  const s = STR[lang];
  const r = order.recipient_snapshot;
  const orderTime = formatOrderTime(order.paid_at ?? order.created_at, lang);
  const lines = [
    s.confirmationHeading,
    s.confirmationIntro,
    "",
    `${s.orderNumber}: #${order.id.slice(0, 8)}`,
    orderTime ? `${s.orderedOn}: ${orderTime}` : "",
    "",
    s.itemsHeading + ":",
    ...items.map((i) => `- ${i.name_snapshot} x${i.qty}: ${fmt(i.line_total_cents)}`),
    "",
    `${s.subtotal}: ${fmt(order.subtotal_cents)}`,
    `${s.shipping}: ${order.shipping_fee_cents === 0 ? s.free : fmt(order.shipping_fee_cents)}`,
    order.gst_registered_at_checkout ? `${s.gst}: ${fmt(order.gst_cents)}` : "",
    `${s.total}: ${fmt(order.total_cents)}`,
    "",
    `${s.recipient}: ${r.name}`,
    `${s.phone}: ${r.phone}`,
    order.delivery_method === "self_collection" ? "" : `${r.address}${r.postalCode ? ", " + r.postalCode : ""}`,
    "",
    order.delivery_method === "self_collection" ? s.deliverySelfCollectionNotice : s.deliveryStandardNotice,
    s.ageNotice,
    "",
    `${s.viewOrderBtn}: ${siteUrl()}/orders.html`,
    `${s.whatsappBtn}: ${WHATSAPP_URL}`,
    "",
    STR[lang].footerCompany + " · UEN 202509360N",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

function staffNotificationHtml(order: OrderForEmail, items: OrderItemForEmail[]): string {
  // Internal ops email — kept English-only regardless of any future
  // customer-language snapshot, per the requirement that only the subject
  // needs the bilingual "New paid order／新已付款订单" label.
  const lang: Lang = "en";
  const s = STR[lang];
  const r = order.recipient_snapshot;
  const orderTime = formatOrderTime(order.paid_at ?? order.created_at, lang);
  const deliveryMethodLabel = order.delivery_method === "self_collection" ? s.deliveryMethodSelfCollection : s.deliveryMethodStandard;
  const adminOrigin = adminAppOrigin();

  const body = `
<h1 style="font-family:Georgia,'Times New Roman',serif;font-size:20px;margin:0 0 16px;color:#1a1a1a;">${escapeHtml(
    s.staffHeading
  )} — #${escapeHtml(order.id.slice(0, 8))}</h1>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf9f6;border:1px solid #ececec;margin-bottom:20px;">
<tr><td style="padding:14px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="font-size:12px;color:#999999;padding:2px 0;">${escapeHtml(s.staffPaymentStatus)}</td><td style="font-size:13px;color:#1a7a1a;font-weight:bold;text-align:right;padding:2px 0;">${escapeHtml(
    s.staffPaid
  )}</td></tr>
<tr><td style="font-size:12px;color:#999999;padding:2px 0;">${escapeHtml(s.total)}</td><td style="font-size:13px;color:#1a1a1a;font-weight:bold;text-align:right;padding:2px 0;">${fmt(
    order.total_cents
  )}</td></tr>
<tr><td style="font-size:12px;color:#999999;padding:2px 0;">${escapeHtml(s.staffDeliveryMethod)}</td><td style="font-size:13px;color:#1a1a1a;text-align:right;padding:2px 0;">${escapeHtml(
    deliveryMethodLabel
  )}</td></tr>
${
  orderTime
    ? `<tr><td style="font-size:12px;color:#999999;padding:2px 0;">${escapeHtml(s.staffOrderedOn)}</td><td style="font-size:13px;color:#1a1a1a;text-align:right;padding:2px 0;">${escapeHtml(
        orderTime
      )}</td></tr>`
    : ""
}
</table>
</td></tr>
</table>

<h2 style="font-size:13px;color:#1a1a1a;margin:0 0 8px;letter-spacing:0.5px;">${escapeHtml(s.itemsHeading)}</h2>
${itemsTableHtml(items, lang)}

<div style="height:20px;"></div>
<h2 style="font-size:13px;color:#1a1a1a;margin:0 0 8px;letter-spacing:0.5px;">${escapeHtml(s.staffCustomer)}</h2>
<p style="font-size:13px;color:#444444;line-height:1.7;margin:0;">
${escapeHtml(r.name)} &middot; ${escapeHtml(r.phone)} &middot; ${escapeHtml(r.email)}<br>
${escapeHtml(s.staffAddress)}: ${
    order.delivery_method === "self_collection" || !r.address
      ? escapeHtml(s.staffNoAddress)
      : escapeHtml(r.address) + (r.postalCode ? ", " + escapeHtml(r.postalCode) : "")
  }
</p>

${
  r.notes
    ? `<div style="height:16px;"></div><h2 style="font-size:13px;color:#1a1a1a;margin:0 0 8px;letter-spacing:0.5px;">${escapeHtml(
        s.staffNotes
      )}</h2><p style="font-size:13px;color:#444444;line-height:1.6;margin:0;">${escapeHtml(r.notes)}</p>`
    : ""
}

<div style="height:20px;"></div>
<h2 style="font-size:13px;color:#1a1a1a;margin:0 0 8px;letter-spacing:0.5px;">${escapeHtml(s.staffAmounts)}</h2>
${totalsTableHtml(order, lang)}

${adminOrigin ? `<div style="height:28px;"></div>${buttonHtml(s.staffViewInAdminBtn, `${adminOrigin}/orders/${order.id}`, "dark")}` : ""}
`;

  return emailShell({ lang, preheader: `${s.staffHeading} #${order.id.slice(0, 8)}`, bodyHtml: body });
}

function staffNotificationText(order: OrderForEmail, items: OrderItemForEmail[]): string {
  const lang: Lang = "en";
  const s = STR[lang];
  const r = order.recipient_snapshot;
  const orderTime = formatOrderTime(order.paid_at ?? order.created_at, lang);
  const deliveryMethodLabel = order.delivery_method === "self_collection" ? s.deliveryMethodSelfCollection : s.deliveryMethodStandard;
  const adminOrigin = adminAppOrigin();
  const lines = [
    `${s.staffHeading} — #${order.id.slice(0, 8)}`,
    "",
    `${s.staffPaymentStatus}: ${s.staffPaid}`,
    `${s.total}: ${fmt(order.total_cents)}`,
    `${s.staffDeliveryMethod}: ${deliveryMethodLabel}`,
    orderTime ? `${s.staffOrderedOn}: ${orderTime}` : "",
    "",
    `${s.itemsHeading}:`,
    ...items.map((i) => `- ${i.name_snapshot} x${i.qty}: ${fmt(i.line_total_cents)}`),
    "",
    `${s.staffCustomer}: ${r.name} · ${r.phone} · ${r.email}`,
    `${s.staffAddress}: ${
      order.delivery_method === "self_collection" || !r.address
        ? s.staffNoAddress
        : r.address + (r.postalCode ? ", " + r.postalCode : "")
    }`,
    r.notes ? `${s.staffNotes}: ${r.notes}` : "",
    "",
    adminOrigin ? `${s.staffViewInAdminBtn}: ${adminOrigin}/orders/${order.id}` : "",
  ];
  return lines.filter((l) => l !== "").join("\n");
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
  buildEmail: () => { subject: string; html: string; text: string };
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

  const { subject, html, text } = params.buildEmail();

  try {
    const resend = new Resend(requireEnv("RESEND_API_KEY"));
    const result = await resend.emails.send(
      { from: fromAddress(), to: params.recipient, subject, html, text },
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
  const lang = resolveOrderLocale(order.locale);
  await sendTrackedEmail({
    orderId: order.id,
    emailType: "customer_confirmation",
    recipient: order.recipient_snapshot.email,
    buildEmail: () => ({
      subject: `${STR[lang].confirmationSubject} #${order.id.slice(0, 8)}`,
      html: customerConfirmationHtml(order, items, lang),
      text: customerConfirmationText(order, items, lang),
    }),
  });
}

/**
 * Staff-initiated resend from admin-app — always a new tracked attempt
 * (see forceNew's doc comment on sendTrackedEmail/claim_email_send).
 * Uses the order's own locale, same as the automatic send — an admin/ops
 * user resending in their own UI language must never change which
 * language the customer actually receives.
 */
export async function resendOrderConfirmationEmail(
  order: OrderForEmail,
  items: OrderItemForEmail[],
  staffUserId: string
): Promise<{ outcome: SendOutcome }> {
  const lang = resolveOrderLocale(order.locale);
  return sendTrackedEmail({
    orderId: order.id,
    emailType: "customer_confirmation",
    recipient: order.recipient_snapshot.email,
    createdBy: staffUserId,
    forceNew: true,
    buildEmail: () => ({
      subject: `${STR[lang].confirmationSubject} #${order.id.slice(0, 8)}`,
      html: customerConfirmationHtml(order, items, lang),
      text: customerConfirmationText(order, items, lang),
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

/**
 * Same shape as sendPaymentReviewAlertEmail, for the refund-webhook side of
 * the same "Stripe told us something that doesn't line up with our own
 * records, and a human needs to look before anything else happens"
 * pattern — see stripe-webhook.ts's refund.updated/refund.failed handling.
 * Deliberately never touches orders.refunded_cents itself; that's the
 * whole point of routing a mismatch here instead of into apply_refund_status.
 */
export async function sendRefundReviewAlertEmail(orderId: string, refundId: string, reason: string): Promise<void> {
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
      subject: `⚠️ Order #${orderId.slice(0, 8)} needs manual review — refund event mismatch`,
      html: `
        <h1 style="font-family:serif;color:#b00;">Refund review needed</h1>
        <p>Order <strong>#${orderId.slice(0, 8)}</strong> — a Stripe refund webhook (<code>${escapeHtml(refundId)}</code>)
        arrived with details that didn't match our own records, so it was deliberately left unapplied.</p>
        <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
        <p>Check Stripe's dashboard for this refund and this order's <code>refund_requests</code> rows before
        deciding how to reconcile it — nothing on this order's refunded amount or status was changed by this event.</p>
      `,
    });
  } catch (err) {
    console.error("sendRefundReviewAlertEmail failed", orderId, refundId, err);
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
    buildEmail: () => ({
      subject: `${STR.en.staffSubjectPrefix} #${order.id.slice(0, 8)} — ${fmt(order.total_cents)}`,
      html: staffNotificationHtml(order, items),
      text: staffNotificationText(order, items),
    }),
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
    buildEmail: () => ({
      subject: `${STR.en.staffSubjectPrefix} #${order.id.slice(0, 8)} — ${fmt(order.total_cents)}`,
      html: staffNotificationHtml(order, items),
      text: staffNotificationText(order, items),
    }),
  });
}

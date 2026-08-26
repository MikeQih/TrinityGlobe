import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import { StatusBadge } from "../components/StatusBadge";
import type { EmailLog, EmailType, Order, OrderItem, OrderStatus, OrderStatusHistoryEntry } from "../lib/types";

const EMAIL_TYPE_LABEL: Record<EmailType, string> = {
  customer_confirmation: "Customer confirmation",
  staff_notification: "Staff notification",
};

// 'accepted' only means Resend's API call succeeded, not that anyone
// actually got the email — see 0019_email_delivery_tracking.sql. Framing
// it as "Sending…" here rather than "Accepted" keeps that distinction
// from reading as more final than it is.
const EMAIL_STATUS_LABEL: Record<EmailLog["status"], string> = {
  pending: "Sending…",
  accepted: "Sent, awaiting delivery confirmation",
  delivered: "Delivered",
  delayed: "Delivery delayed",
  failed: "Failed to send",
  bounced: "Bounced",
  suppressed: "Suppressed",
};

// Only the *fulfilment* forward-steps live here — refunded is deliberately
// never a button in this list, it only ever happens through the Refund
// section below. Once an order has been paid, "the customer doesn't get
// it" is a refund (money moves back), not a cancellation (no money moved);
// cancelled is only reachable from pending_payment. completed/cancelled/
// expired/payment_failed/refunded/payment_review all have no entry here —
// each is a dead end for this button row (payment_review especially:
// see the warning banner below for why). Mirrors the transition graph
// enforced server-side by supabase/migrations/0011_order_status_transition_guard.sql —
// this map only needs to be a subset of what the DB allows, never wider.
const NEXT_STATUS_OPTIONS: Partial<Record<OrderStatus, { status: OrderStatus; label: string }[]>> = {
  pending_payment: [{ status: "cancelled", label: "Cancel order" }],
  paid: [{ status: "preparing", label: "Mark as Preparing" }],
  preparing: [
    { status: "ready_for_collection", label: "Mark as Ready for Collection" },
    { status: "out_for_delivery", label: "Mark as Out for Delivery" },
  ],
  ready_for_collection: [{ status: "completed", label: "Mark as Completed" }],
  out_for_delivery: [{ status: "completed", label: "Mark as Completed" }],
};

function fmt(cents: number): string {
  return "S$" + (cents / 100).toFixed(2);
}

function paymentStatusLabel(order: Order): string {
  switch (order.status) {
    case "pending_payment":
      return "Not paid — awaiting customer";
    case "payment_failed":
      return "Payment failed";
    case "expired":
      return "Payment window expired, unpaid";
    case "cancelled":
      return "Cancelled, unpaid";
    case "payment_review":
      return "Stripe reports paid — needs manual verification";
    case "refunded":
      return order.refunded_cents >= order.total_cents ? "Paid, fully refunded" : "Paid, partially refunded";
    default:
      return order.refunded_cents > 0 ? "Paid, partially refunded" : "Paid";
  }
}

export function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { role, session } = useAuth();
  const canWrite = role === "admin" || role === "ops";

  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [history, setHistory] = useState<OrderStatusHistoryEntry[]>([]);
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [resendingEmailType, setResendingEmailType] = useState<EmailType | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [orderRes, itemsRes, historyRes, emailLogsRes] = await Promise.all([
      supabase.from("orders").select("*").eq("id", id).single<Order>(),
      supabase.from("order_items").select("*").eq("order_id", id).returns<OrderItem[]>(),
      supabase
        .from("order_status_history")
        .select("*")
        .eq("order_id", id)
        .order("changed_at", { ascending: true })
        .returns<OrderStatusHistoryEntry[]>(),
      supabase
        .from("email_logs")
        .select("*")
        .eq("order_id", id)
        .order("created_at", { ascending: false })
        .returns<EmailLog[]>(),
    ]);

    if (orderRes.error) setError(orderRes.error.message);
    else {
      setOrder(orderRes.data);
      setNotes(orderRes.data?.internal_notes ?? "");
    }
    if (itemsRes.data) setItems(itemsRes.data);
    if (historyRes.data) setHistory(historyRes.data);
    if (emailLogsRes.data) setEmailLogs(emailLogsRes.data);
    setLoading(false);
  }, [id]);

  // email_logs can carry several rows per type (retries, resends) — only
  // the latest attempt per type is what staff need to see as "the current
  // status", ordered newest-first by the query above so the first match
  // per type wins.
  function latestEmailLog(emailType: EmailType): EmailLog | null {
    return emailLogs.find((l) => l.email_type === emailType) ?? null;
  }

  useEffect(() => {
    void load();
  }, [load]);

  async function handleStatusChange(newStatus: OrderStatus): Promise<void> {
    if (!order) return;
    setUpdatingStatus(true);
    setActionError(null);

    // Cancelling a still-pending order needs to close its Stripe session
    // and release the held stock, neither of which a plain status column
    // update does — routed through admin-cancel-order.ts instead, the same
    // way the customer-facing cancel-my-order.ts handles it. Every other
    // transition here is a plain fulfilment step with no side effects
    // beyond the status itself, so a direct update is fine for those.
    if (order.status === "pending_payment" && newStatus === "cancelled") {
      if (!session) return;
      try {
        const res = await fetch(`${import.meta.env.VITE_STOREFRONT_FUNCTIONS_URL}/.netlify/functions/admin-cancel-order`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ orderId: order.id }),
        });
        const resBody = await res.json();
        if (!res.ok) throw new Error(resBody?.error ?? "Failed to cancel order");
        await load();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to cancel order");
      } finally {
        setUpdatingStatus(false);
      }
      return;
    }

    // The transition itself is still validated authoritatively by
    // trg_validate_order_status_transition (0011_order_status_transition_guard.sql)
    // regardless of what this button list offers — this is a second,
    // UI-level guard against showing an invalid option in the first place,
    // not the actual security boundary.
    //
    // .select() here isn't just for the return value: a plain .update()
    // reports error=null whenever RLS's "ops and admin can update orders"
    // policy filters the target row down to zero matches (e.g. a
    // finance_readonly account, which is a real admin_profiles role with
    // no UPDATE policy of its own) — Postgres doesn't error on a
    // zero-row UPDATE, it just updates nothing. Without .select(), that
    // reads as silent success: the button spins, nothing happens, and
    // there's no indication why. Chaining .select() forces PostgREST to
    // report back which rows actually changed, so a permission-denied
    // outcome can be told apart from a real success and shown as such.
    const { data: updated, error: updateError } = await supabase
      .from("orders")
      .update({ status: newStatus })
      .eq("id", order.id)
      .select("id");
    setUpdatingStatus(false);
    if (updateError) setActionError(updateError.message);
    else if (!updated || updated.length === 0) {
      setActionError("Update was not applied — you may not have permission to change this order's status.");
    } else void load();
  }

  async function handleSaveNotes(): Promise<void> {
    if (!order) return;
    // Same reasoning as handleStatusChange above: .select() is required to
    // tell a real save apart from a silently RLS-blocked one.
    const { data: updated, error: updateError } = await supabase
      .from("orders")
      .update({ internal_notes: notes })
      .eq("id", order.id)
      .select("id");
    if (updateError) setActionError(updateError.message);
    else if (!updated || updated.length === 0) {
      setActionError("Notes were not saved — you may not have permission to edit this order.");
    }
  }

  async function handleRefund(full: boolean): Promise<void> {
    if (!order || !session) return;
    const remaining = order.total_cents - order.refunded_cents;
    if (remaining <= 0) return;

    let amountCents: number | undefined;
    if (!full) {
      const input = window.prompt(`Refund amount in S$ (max ${fmt(remaining)}):`);
      if (!input) return;
      const parsed = Math.round(parseFloat(input) * 100);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setActionError("Enter a valid refund amount.");
        return;
      }
      amountCents = parsed;
    }

    setRefunding(true);
    setActionError(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_STOREFRONT_FUNCTIONS_URL}/.netlify/functions/admin-refund-order`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        // No client-generated idempotency key — admin-refund-order.ts's
        // claim_refund_request RPC hands back a durable server-side
        // request row (or resumes an existing pending one for this order)
        // and uses *that* row's own id as the Stripe idempotency key. See
        // supabase/migrations/0014_refund_request_ledger.sql for why a
        // fresh per-click key wasn't enough — it did nothing for a
        // network timeout, a page refresh, a second tab, or two staff
        // members refunding the same order at once.
        body: JSON.stringify({ orderId: order.id, amountCents }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Refund failed");
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Refund failed");
    } finally {
      setRefunding(false);
    }
  }

  async function handleResendEmail(emailType: EmailType): Promise<void> {
    if (!order || !session) return;
    setResendingEmailType(emailType);
    setResendMessage(null);
    setActionError(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_STOREFRONT_FUNCTIONS_URL}/.netlify/functions/admin-resend-order-email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ orderId: order.id, emailType }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Failed to resend email");
      setResendMessage(
        body.outcome === "accepted"
          ? `${EMAIL_TYPE_LABEL[emailType]} email resent.`
          : `${EMAIL_TYPE_LABEL[emailType]} resend was accepted by the queue but hasn't confirmed sending yet — check back shortly.`
      );
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to resend email");
    } finally {
      setResendingEmailType(null);
    }
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="error-banner">{error}</p>;
  if (!order) return <p className="muted">Order not found.</p>;

  const remainingRefundCents = order.total_cents - order.refunded_cents;
  const r = order.recipient_snapshot;
  const nextOptions = NEXT_STATUS_OPTIONS[order.status] ?? [];

  return (
    <div className="order-detail">
      <header className="order-detail-header">
        <h1>Order #{order.id.slice(0, 8)}</h1>
        <StatusBadge status={order.status} />
      </header>

      {actionError && <p className="error-banner">{actionError}</p>}

      {order.status === "payment_review" && (
        <div className="warning-banner">
          <strong>⚠ Needs manual verification before doing anything else.</strong>
          <p>
            Stripe reported this payment as successful, but it couldn't be confirmed automatically — either the
            charged amount didn't match this order's total, or the order was no longer awaiting payment when the
            webhook arrived. <strong>Do not ship this order yet.</strong> Check the Payment Intent below in the
            Stripe dashboard to confirm whether the charge really went through, then either confirm it manually in
            the database or refund it — this app doesn't offer a one-click resolution for this state on purpose,
            to avoid double-confirming or double-releasing stock.
          </p>
        </div>
      )}

      <section className="order-section">
        <h2>Customer</h2>
        <p>{r.name} &middot; {r.phone} &middot; {r.email}</p>
        <p>
          {order.delivery_method === "self_collection" ? "Self collection" : `${r.address}, ${r.postalCode}`}
        </p>
        {r.notes && <p className="muted">Customer note: {r.notes}</p>}
        <p className="muted">
          This is the address captured at checkout time, not a live link to the customer's saved address book —
          it won't change if they edit or delete that saved address later.
        </p>
      </section>

      <section className="order-section">
        <h2>Items</h2>
        <table className="order-items-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Unit price</th>
              <th>Qty</th>
              <th>Line total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.sku}</td>
                <td>{i.name_snapshot}</td>
                <td className="num">{fmt(i.unit_price_cents)}</td>
                <td>{i.qty}</td>
                <td className="num">{fmt(i.line_total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="order-totals">
          <div><span>Subtotal</span><span>{fmt(order.subtotal_cents)}</span></div>
          <div><span>Shipping</span><span>{order.shipping_fee_cents === 0 ? "Free" : fmt(order.shipping_fee_cents)}</span></div>
          <div>
            <span>GST (inclusive)</span>
            <span>
              {order.gst_registered_at_checkout
                ? `${fmt(order.gst_cents)} (${(order.gst_rate * 100).toFixed(0)}%)`
                : "Not applicable — not GST-registered at checkout"}
            </span>
          </div>
          <div className="total-row"><span>Total</span><span>{fmt(order.total_cents)}</span></div>
          {order.refunded_cents > 0 && (
            <div className="refunded-row"><span>Refunded</span><span>{fmt(order.refunded_cents)}</span></div>
          )}
        </div>
      </section>

      <section className="order-section">
        <h2>Payment</h2>
        <p>{paymentStatusLabel(order)}</p>
        <dl className="payment-ids">
          <dt>Stripe Checkout Session</dt>
          <dd>{order.stripe_checkout_session_id ?? <span className="muted">none</span>}</dd>
          <dt>Stripe Payment Intent</dt>
          <dd>{order.stripe_payment_intent_id ?? <span className="muted">none</span>}</dd>
        </dl>
      </section>

      <section className="order-section">
        <h2>Fulfilment</h2>
        {canWrite ? (
          nextOptions.length > 0 ? (
            <div className="status-actions">
              {nextOptions.map(({ status: s, label }) => (
                <button key={s} disabled={updatingStatus} onClick={() => void handleStatusChange(s)}>
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">
              {order.status === "payment_review"
                ? "No self-service action while this order needs manual verification — see the warning above."
                : "No further status change available from here — use the Refund section below if this order needs to be undone."}
            </p>
          )
        ) : (
          <p className="muted">Read-only access — status changes require an ops or admin role.</p>
        )}
      </section>

      <section className="order-section">
        <h2>Internal notes</h2>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canWrite} rows={3} />
        {canWrite && <button onClick={() => void handleSaveNotes()}>Save notes</button>}
      </section>

      {canWrite && order.stripe_payment_intent_id && remainingRefundCents > 0 && (
        <section className="order-section">
          <h2>Refund</h2>
          <p className="muted">Remaining refundable: {fmt(remainingRefundCents)}</p>
          <div className="refund-actions">
            <button disabled={refunding} onClick={() => void handleRefund(true)}>
              {refunding ? "Processing…" : "Refund in full"}
            </button>
            <button disabled={refunding} onClick={() => void handleRefund(false)}>
              Refund partial amount…
            </button>
          </div>
        </section>
      )}

      <section className="order-section">
        <h2>Email</h2>
        <div className="email-status-section">
          {(["customer_confirmation", "staff_notification"] as EmailType[]).map((emailType) => {
            const log = latestEmailLog(emailType);
            // Delivered is the one status where a resend button is hidden
            // by default — see PROJECT_STATUS.md's email tracking round:
            // the point is avoiding an accidental duplicate send of
            // something that already reached its destination, not making
            // it impossible. finance_readonly never sees a resend button
            // regardless of status, same as every other write action on
            // this page.
            const showResendButton = canWrite && log?.status !== "delivered";
            return (
              <div className="email-status-row" key={emailType}>
                <span className="email-status-label">{EMAIL_TYPE_LABEL[emailType]}</span>
                {log ? (
                  <>
                    <span className="email-status-badge" data-status={log.status}>
                      {EMAIL_STATUS_LABEL[log.status]}
                    </span>
                    {log.failure_reason && <span className="email-status-reason">{log.failure_reason}</span>}
                  </>
                ) : (
                  <span className="muted">No record — never sent for this order.</span>
                )}
                {showResendButton && (
                  <button
                    disabled={resendingEmailType === emailType}
                    onClick={() => void handleResendEmail(emailType)}
                  >
                    {resendingEmailType === emailType ? "Sending…" : log ? "Resend" : "Send now"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {resendMessage && <p className="muted">{resendMessage}</p>}
      </section>

      <section className="order-section">
        <h2>History</h2>
        <p className="muted">Order placed: {new Date(order.created_at).toLocaleString()}</p>
        <p className="muted">Last updated: {new Date(order.updated_at).toLocaleString()}</p>
        <ul className="history-list">
          {history.map((h) => (
            <li key={h.id}>
              <span>{new Date(h.changed_at).toLocaleString()}</span>
              <span>{h.from_status ? `${h.from_status} → ${h.to_status}` : `created as ${h.to_status}`}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

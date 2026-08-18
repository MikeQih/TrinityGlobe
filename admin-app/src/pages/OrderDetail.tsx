import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import { StatusBadge } from "../components/StatusBadge";
import type { Order, OrderItem, OrderStatus, OrderStatusHistoryEntry } from "../lib/types";

const NEXT_STATUS_OPTIONS: OrderStatus[] = [
  "paid",
  "preparing",
  "ready_for_collection",
  "out_for_delivery",
  "completed",
  "cancelled",
];

function fmt(cents: number): string {
  return "S$" + (cents / 100).toFixed(2);
}

export function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { role, session } = useAuth();
  const canWrite = role === "admin" || role === "ops";

  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [history, setHistory] = useState<OrderStatusHistoryEntry[]>([]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [orderRes, itemsRes, historyRes] = await Promise.all([
      supabase.from("orders").select("*").eq("id", id).single<Order>(),
      supabase.from("order_items").select("*").eq("order_id", id).returns<OrderItem[]>(),
      supabase
        .from("order_status_history")
        .select("*")
        .eq("order_id", id)
        .order("changed_at", { ascending: true })
        .returns<OrderStatusHistoryEntry[]>(),
    ]);

    if (orderRes.error) setError(orderRes.error.message);
    else {
      setOrder(orderRes.data);
      setNotes(orderRes.data?.internal_notes ?? "");
    }
    if (itemsRes.data) setItems(itemsRes.data);
    if (historyRes.data) setHistory(historyRes.data);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleStatusChange(newStatus: OrderStatus): Promise<void> {
    if (!order) return;
    setUpdatingStatus(true);
    setActionError(null);
    const { error: updateError } = await supabase.from("orders").update({ status: newStatus }).eq("id", order.id);
    setUpdatingStatus(false);
    if (updateError) setActionError(updateError.message);
    else void load();
  }

  async function handleSaveNotes(): Promise<void> {
    if (!order) return;
    const { error: updateError } = await supabase
      .from("orders")
      .update({ internal_notes: notes })
      .eq("id", order.id);
    if (updateError) setActionError(updateError.message);
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

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="error-banner">{error}</p>;
  if (!order) return <p className="muted">Order not found.</p>;

  const remainingRefundCents = order.total_cents - order.refunded_cents;
  const r = order.recipient_snapshot;

  return (
    <div className="order-detail">
      <header className="order-detail-header">
        <h1>Order #{order.id.slice(0, 8)}</h1>
        <StatusBadge status={order.status} />
      </header>

      {actionError && <p className="error-banner">{actionError}</p>}

      <section className="order-section">
        <h2>Customer</h2>
        <p>{r.name} &middot; {r.phone} &middot; {r.email}</p>
        <p>
          {order.delivery_method === "self_collection" ? "Self collection" : `${r.address}, ${r.postalCode}`}
        </p>
        {r.notes && <p className="muted">Customer note: {r.notes}</p>}
      </section>

      <section className="order-section">
        <h2>Items</h2>
        <table className="order-items-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Qty</th>
              <th>Line total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.sku}</td>
                <td>{i.name_snapshot}</td>
                <td>{i.qty}</td>
                <td className="num">{fmt(i.line_total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="order-totals">
          <div><span>Subtotal</span><span>{fmt(order.subtotal_cents)}</span></div>
          <div><span>Shipping</span><span>{order.shipping_fee_cents === 0 ? "Free" : fmt(order.shipping_fee_cents)}</span></div>
          <div className="total-row"><span>Total</span><span>{fmt(order.total_cents)}</span></div>
          {order.refunded_cents > 0 && (
            <div className="refunded-row"><span>Refunded</span><span>{fmt(order.refunded_cents)}</span></div>
          )}
        </div>
      </section>

      <section className="order-section">
        <h2>Fulfilment</h2>
        {canWrite ? (
          <div className="status-actions">
            {NEXT_STATUS_OPTIONS.map((s) => (
              <button key={s} disabled={updatingStatus || order.status === s} onClick={() => void handleStatusChange(s)}>
                {s}
              </button>
            ))}
          </div>
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
        <h2>History</h2>
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

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { StatusBadge } from "../components/StatusBadge";
import type { Order, OrderStatus } from "../lib/types";

const STATUS_FILTERS: Array<OrderStatus | "all"> = [
  "all",
  "pending_payment",
  "paid",
  "preparing",
  "ready_for_collection",
  "out_for_delivery",
  "completed",
  "cancelled",
  "expired",
  "refunded",
  "payment_failed",
  "payment_review",
];

function fmt(cents: number): string {
  return "S$" + (cents / 100).toFixed(2);
}

export function OrdersList() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    let query = supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(200);
    if (statusFilter !== "all") query = query.eq("status", statusFilter);

    query.then(({ data, error: queryError }) => {
      if (cancelled) return;
      if (queryError) setError(queryError.message);
      else setOrders((data ?? []) as Order[]);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [statusFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      const r = o.recipient_snapshot;
      return (
        o.id.toLowerCase().includes(q) ||
        r?.name?.toLowerCase().includes(q) ||
        r?.phone?.toLowerCase().includes(q) ||
        r?.email?.toLowerCase().includes(q)
      );
    });
  }, [orders, search]);

  return (
    <div className="orders-list">
      <div className="orders-toolbar">
        <input
          type="search"
          placeholder="Search by order id, name, phone, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as OrderStatus | "all")}>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="error-banner">{error}</p>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No orders match.</p>
      ) : (
        <table className="orders-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Total</th>
              <th>Placed</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link to={`/orders/${o.id}`}>#{o.id.slice(0, 8)}</Link>
                </td>
                <td>{o.recipient_snapshot?.name}</td>
                <td>
                  <StatusBadge status={o.status} />
                </td>
                <td className="num">{fmt(o.total_cents)}</td>
                <td>{new Date(o.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

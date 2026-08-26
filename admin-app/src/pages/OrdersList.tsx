import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { StatusBadge } from "../components/StatusBadge";
import type { EmailLog, Order, OrderStatus } from "../lib/types";

const EMAIL_ISSUE_STATUSES = new Set(["failed", "bounced", "suppressed"]);

// Reduces every email_logs row seen for the visible orders down to the
// latest attempt per (order_id, email_type) — an order whose *first*
// attempt bounced but was then successfully resent shouldn't still show
// as an issue. Assumes rows arrive ordered newest-first (the query below
// sorts by created_at desc), so the first row seen per key wins.
function latestStatusByOrder(logs: EmailLog[]): Map<string, EmailLog[]> {
  const seenKeys = new Set<string>();
  const byOrder = new Map<string, EmailLog[]>();
  for (const log of logs) {
    const key = log.order_id + ":" + log.email_type;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const list = byOrder.get(log.order_id) ?? [];
    list.push(log);
    byOrder.set(log.order_id, list);
  }
  return byOrder;
}

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

// How often the list re-fetches on its own so a new order (or a status
// change from another tab/device) shows up without a manual page reload.
// There's no Supabase Realtime subscription wired up for this table, so
// polling is the simplest thing that actually satisfies "new orders show
// up promptly" for a back-office tool that's usually just left open.
const AUTO_REFRESH_MS = 30_000;

// release-expired-reservations.ts runs every 5 minutes (see its own
// `config.schedule`) and records a heartbeat in scheduled_job_runs on
// every run — see 0015_scheduled_job_health.sql. Three missed runs' worth
// of slack before flagging it here, since Netlify's scheduler isn't
// perfectly on-the-second and a single slow run shouldn't page anyone.
const STALE_JOB_THRESHOLD_MS = 15 * 60_000;

function StaleJobWarning() {
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    supabase
      .from("scheduled_job_runs")
      .select("last_success_at")
      .eq("job_name", "release_expired_reservations")
      .maybeSingle()
      .then(({ data }) => setLastSuccessAt(data?.last_success_at ?? null));
  }, []);

  if (lastSuccessAt === undefined) return null; // still loading — don't flash a false warning
  const isStale = !lastSuccessAt || Date.now() - new Date(lastSuccessAt).getTime() > STALE_JOB_THRESHOLD_MS;
  if (!isStale) return null;

  return (
    <div className="warning-banner">
      <strong>⚠ Stock-release job hasn't reported success recently.</strong>
      <p>
        {lastSuccessAt
          ? `Last successful run: ${new Date(lastSuccessAt).toLocaleString()}.`
          : "It has never reported a successful run."}{" "}
        Abandoned pending-payment orders may be holding stock past their expiry — check that
        release-expired-reservations is deployed and its scheduled runs are succeeding in the Netlify dashboard.
      </p>
    </div>
  );
}

export function OrdersList() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [emailIssueOrderIds, setEmailIssueOrderIds] = useState<Set<string>>(new Set());

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
  }, [statusFilter, refreshTick]);

  // A separate query rather than a join: email_logs can have several rows
  // per order (retries, resends), and only the *latest* attempt per
  // (order_id, email_type) should count toward "this order has an email
  // problem right now" — see latestStatusByOrder above.
  useEffect(() => {
    if (orders.length === 0) {
      setEmailIssueOrderIds(new Set());
      return;
    }
    let cancelled = false;
    supabase
      .from("email_logs")
      .select("*")
      .in(
        "order_id",
        orders.map((o) => o.id)
      )
      .order("created_at", { ascending: false })
      .then(({ data, error: queryError }) => {
        if (cancelled || queryError || !data) return;
        const byOrder = latestStatusByOrder(data as EmailLog[]);
        const issues = new Set<string>();
        for (const [orderId, logs] of byOrder) {
          if (logs.some((l) => EMAIL_ISSUE_STATUSES.has(l.status))) issues.add(orderId);
        }
        setEmailIssueOrderIds(issues);
      });
    return () => {
      cancelled = true;
    };
  }, [orders]);

  useEffect(() => {
    const interval = window.setInterval(() => setRefreshTick((t) => t + 1), AUTO_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, []);

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
      <StaleJobWarning />
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
        <button type="button" onClick={() => setRefreshTick((t) => t + 1)} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
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
                  {emailIssueOrderIds.has(o.id) && (
                    <span className="email-issue-flag" title="A confirmation or notification email for this order failed, bounced, or was suppressed — see the Email section on the order page.">
                      {" "}
                      ⚠ Email
                    </span>
                  )}
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

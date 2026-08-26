import { getSupabaseAdmin, getUserIdFromRequest } from "./_lib/supabase";
import { jsonResponse, errorResponse } from "./_lib/responses";

interface OrderRow {
  id: string;
  status: string;
  total_cents: number;
  subtotal_cents: number;
  shipping_fee_cents: number;
  refunded_cents: number;
  currency: string;
  delivery_method: string;
  created_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
  recipient_snapshot: { name: string; phone: string; email: string; address: string; postalCode: string; notes: string };
  stripe_checkout_session_id: string | null;
}

interface OrderItemRow {
  order_id: string;
  sku: string;
  name_snapshot: string;
  qty: number;
  unit_price_cents: number;
}

interface ReservationRow {
  order_id: string;
  expires_at: string;
}

/**
 * GET, requires `Authorization: Bearer <supabase access token>`.
 *
 * Returns the signed-in customer's own orders, newest first, with enough
 * detail for both the order list and the detail view (orders.html / src/
 * orders-page.ts) — recipient snapshot, delivery/payment info, and, for
 * still-pending orders, when the backing stock reservation expires (so the
 * "continue payment before HH:MM" countdown doesn't need a second request).
 * The user id comes from verifying the token against Supabase Auth
 * (getUserIdFromRequest), never from anything the client could spoof, so
 * this can never return another customer's orders.
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return errorResponse(405, "Method not allowed");

  const userId = await getUserIdFromRequest(req);
  if (!userId) return errorResponse(401, "Not signed in");

  const supabase = getSupabaseAdmin();

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select(
      "id, status, total_cents, subtotal_cents, shipping_fee_cents, refunded_cents, currency, delivery_method, created_at, paid_at, cancelled_at, recipient_snapshot, stripe_checkout_session_id"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .returns<OrderRow[]>();

  if (ordersError) {
    console.error("get-my-orders: failed to load orders", ordersError);
    return errorResponse(500, "Failed to load orders");
  }

  const orderIds = (orders ?? []).map((o) => o.id);
  const pendingOrderIds = (orders ?? []).filter((o) => o.status === "pending_payment").map((o) => o.id);

  const [{ data: items, error: itemsError }, { data: reservations, error: reservationsError }] = await Promise.all([
    orderIds.length
      ? supabase
          .from("order_items")
          .select("order_id, sku, name_snapshot, qty, unit_price_cents")
          .in("order_id", orderIds)
          .returns<OrderItemRow[]>()
      : Promise.resolve({ data: [] as OrderItemRow[], error: null }),
    pendingOrderIds.length
      ? supabase
          .from("inventory_reservations")
          .select("order_id, expires_at")
          .in("order_id", pendingOrderIds)
          .eq("status", "pending")
          .returns<ReservationRow[]>()
      : Promise.resolve({ data: [] as ReservationRow[], error: null }),
  ]);

  if (itemsError) {
    console.error("get-my-orders: failed to load order_items", itemsError);
    return errorResponse(500, "Failed to load orders");
  }
  if (reservationsError) {
    console.error("get-my-orders: failed to load inventory_reservations", reservationsError);
    return errorResponse(500, "Failed to load orders");
  }

  const itemsByOrder = new Map<string, OrderItemRow[]>();
  for (const item of items ?? []) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
  }

  // A pending order can have more than one reservation row (one per line
  // item) — the earliest expiry is the one that matters for the countdown,
  // since release-expired-reservations.ts acts as soon as any of them lapse.
  const earliestExpiryByOrder = new Map<string, string>();
  for (const r of reservations ?? []) {
    const current = earliestExpiryByOrder.get(r.order_id);
    if (!current || r.expires_at < current) earliestExpiryByOrder.set(r.order_id, r.expires_at);
  }

  const result = (orders ?? []).map((o) => ({
    id: o.id,
    status: o.status,
    totalCents: o.total_cents,
    subtotalCents: o.subtotal_cents,
    shippingFeeCents: o.shipping_fee_cents,
    refundedCents: o.refunded_cents,
    currency: o.currency,
    deliveryMethod: o.delivery_method,
    createdAt: o.created_at,
    paidAt: o.paid_at,
    cancelledAt: o.cancelled_at,
    recipient: o.recipient_snapshot,
    hasCheckoutSession: o.stripe_checkout_session_id != null,
    reservationExpiresAt: earliestExpiryByOrder.get(o.id) ?? null,
    items: (itemsByOrder.get(o.id) ?? []).map((i) => ({
      sku: i.sku,
      name: i.name_snapshot,
      qty: i.qty,
      unitPriceCents: i.unit_price_cents,
    })),
  }));

  return jsonResponse(200, { orders: result });
};

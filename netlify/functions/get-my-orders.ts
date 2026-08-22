import { getSupabaseAdmin, getUserIdFromRequest } from "./_lib/supabase";
import { jsonResponse, errorResponse } from "./_lib/responses";

interface OrderRow {
  id: string;
  status: string;
  total_cents: number;
  currency: string;
  delivery_method: string;
  created_at: string;
}

interface OrderItemRow {
  order_id: string;
  name_snapshot: string;
  qty: number;
  unit_price_cents: number;
}

/**
 * GET, requires `Authorization: Bearer <supabase access token>`.
 *
 * Returns the signed-in customer's own orders, newest first, each with its
 * line items — this is what the My Orders page (orders.html) renders. The
 * user id comes from verifying the token against Supabase Auth
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
    .select("id, status, total_cents, currency, delivery_method, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .returns<OrderRow[]>();

  if (ordersError) {
    console.error("get-my-orders: failed to load orders", ordersError);
    return errorResponse(500, "Failed to load orders");
  }

  const orderIds = (orders ?? []).map((o) => o.id);
  const { data: items, error: itemsError } = orderIds.length
    ? await supabase
        .from("order_items")
        .select("order_id, name_snapshot, qty, unit_price_cents")
        .in("order_id", orderIds)
        .returns<OrderItemRow[]>()
    : { data: [] as OrderItemRow[], error: null };

  if (itemsError) {
    console.error("get-my-orders: failed to load order_items", itemsError);
    return errorResponse(500, "Failed to load orders");
  }

  const itemsByOrder = new Map<string, OrderItemRow[]>();
  for (const item of items ?? []) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
  }

  const result = (orders ?? []).map((o) => ({
    id: o.id,
    status: o.status,
    totalCents: o.total_cents,
    currency: o.currency,
    deliveryMethod: o.delivery_method,
    createdAt: o.created_at,
    items: (itemsByOrder.get(o.id) ?? []).map((i) => ({
      name: i.name_snapshot,
      qty: i.qty,
      unitPriceCents: i.unit_price_cents,
    })),
  }));

  return jsonResponse(200, { orders: result });
};

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";

let client: SupabaseClient | null = null;

/**
 * Server-side only. Uses the service_role key, which bypasses Row Level
 * Security entirely (see the RLS section of supabase/migrations/0001_init.sql)
 * — every Function using this client is trusted to enforce its own
 * authorization, since the database won't.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;
  client = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  return client;
}

/** Releases every still-pending-or-confirmed reservation for an order (used when checkout can't proceed after the order row was already created). */
export async function releaseOrderReservations(supabase: SupabaseClient, orderId: string): Promise<void> {
  const { data: reservations, error } = await supabase
    .from("inventory_reservations")
    .select("id")
    .eq("order_id", orderId)
    .in("status", ["pending", "confirmed"]);

  if (error) {
    console.error("releaseOrderReservations: failed to load reservations", orderId, error);
    return;
  }

  for (const r of reservations ?? []) {
    const { error: releaseError } = await supabase.rpc("release_inventory_reservation", {
      p_reservation_id: r.id,
    });
    if (releaseError) {
      console.error("releaseOrderReservations: release_inventory_reservation failed", r.id, releaseError);
    }
  }
}

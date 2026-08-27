import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";

let client: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;

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

function getSupabaseAnon(): SupabaseClient {
  if (anonClient) return anonClient;
  anonClient = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false },
  });
  return anonClient;
}

/**
 * Resolves the signed-in user's id from a storefront request's
 * `Authorization: Bearer <access_token>` header, or null if there isn't one
 * or it doesn't check out. Used to attach an order to an account without
 * trusting a client-supplied user id — this verifies the token against
 * Supabase Auth itself rather than just decoding it, so a request can't
 * claim to be a different customer than the one who's actually signed in.
 */
export async function getUserIdFromRequest(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);
  const { data, error } = await getSupabaseAnon().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
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

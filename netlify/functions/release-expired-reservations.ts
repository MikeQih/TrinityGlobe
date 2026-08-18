import type { Config } from "@netlify/functions";
import { getSupabaseAdmin } from "./_lib/supabase";

/**
 * Runs on a schedule (see `config` export below) to flip overdue pending
 * reservations to 'expired' — see expire_stale_reservations() in
 * supabase/migrations/0001_init.sql. Pending reservations never decremented
 * website_stock, so this is just a status flip, not a restock; there's
 * nothing here for confirm/release to undo.
 */
export default async (): Promise<Response> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("expire_stale_reservations");

  if (error) {
    console.error("release-expired-reservations: expire_stale_reservations failed", error);
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const expiredCount = Array.isArray(data) ? data.length : 0;
  if (expiredCount > 0) {
    console.log(`release-expired-reservations: expired ${expiredCount} reservation(s)`);
  }

  return new Response(JSON.stringify({ ok: true, expired: expiredCount }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

export const config: Config = {
  schedule: "*/5 * * * *",
};

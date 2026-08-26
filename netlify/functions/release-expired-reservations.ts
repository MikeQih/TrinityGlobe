import type { Config } from "@netlify/functions";
import { getSupabaseAdmin } from "./_lib/supabase";
import { getStripe } from "./_lib/stripe";

const JOB_NAME = "release_expired_reservations";

/**
 * Runs on a schedule (see `config` export below) to flip overdue pending
 * reservations to 'expired' — see expire_stale_reservations() in
 * supabase/migrations/0001_init.sql. Pending reservations never decremented
 * website_stock, so this is just a status flip, not a restock; there's
 * nothing here for confirm/release to undo.
 *
 * Reservation expiry and the backing Stripe Checkout Session's own
 * `expires_at` are set from the same timestamp at order-creation time (see
 * create-checkout-session.ts), but a few hundred ms apart — the reservation
 * is always created first. Rather than rely on that gap staying small, this
 * also actively force-expires each affected order's Stripe session, so a
 * customer can never complete payment against stock we've already released
 * back to the shelf. Expiring a session this way makes Stripe fire its own
 * checkout.session.expired webhook, which flows through the same
 * mark_order_failed_from_webhook path as a natural expiry — no separate
 * order-status logic duplicated here.
 *
 * Records its own last-run/last-success timestamp in scheduled_job_runs
 * (see 0015_scheduled_job_health.sql) on every invocation, success or
 * failure — Netlify Scheduled Functions only run on a real Published
 * Deploy (never a Deploy Preview or branch deploy), so this is what lets
 * admin-app notice if this job has silently never run, rather than that
 * only surfacing when a customer hits "sold out" stock that should have
 * been released back.
 */
export default async (): Promise<Response> => {
  const supabase = getSupabaseAdmin();
  const startedAt = new Date().toISOString();

  try {
    const result = await run(supabase);
    await supabase
      .from("scheduled_job_runs")
      .update({ last_run_at: startedAt, last_success_at: startedAt, last_error: null })
      .eq("job_name", JOB_NAME);
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("release-expired-reservations: run failed", err);
    await supabase.from("scheduled_job_runs").update({ last_run_at: startedAt, last_error: message }).eq("job_name", JOB_NAME);
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};

async function run(
  supabase: ReturnType<typeof getSupabaseAdmin>
): Promise<{ expired: number; stripeSessionsExpired: number }> {
  const { data: expiredReservationIds, error } = await supabase.rpc("expire_stale_reservations");
  if (error) {
    throw new Error(`expire_stale_reservations failed: ${error.message}`);
  }

  const ids: string[] = Array.isArray(expiredReservationIds) ? expiredReservationIds : [];
  let expiredSessionCount = 0;

  if (ids.length > 0) {
    const { data: reservations, error: resError } = await supabase
      .from("inventory_reservations")
      .select("order_id")
      .in("id", ids);
    if (resError) {
      console.error("release-expired-reservations: failed to load orders for expired reservations", resError);
    } else {
      const orderIds = [...new Set((reservations ?? []).map((r) => r.order_id as string))];
      const { data: orders, error: ordersError } = await supabase
        .from("orders")
        .select("id, status, stripe_checkout_session_id")
        .in("id", orderIds)
        .eq("status", "pending_payment");

      if (ordersError) {
        console.error("release-expired-reservations: failed to load orders", ordersError);
      } else {
        const stripe = getStripe();
        for (const order of orders ?? []) {
          if (!order.stripe_checkout_session_id) continue;
          try {
            await stripe.checkout.sessions.expire(order.stripe_checkout_session_id);
            expiredSessionCount++;
          } catch (err) {
            // Already completed/expired on Stripe's side, or some other
            // transient issue — either way there's nothing more to do for
            // this order from here; a customer who paid in the meantime
            // still gets their own checkout.session.completed webhook.
            console.error("release-expired-reservations: failed to expire Stripe session", order.id, err);
          }
        }
      }
    }
  }

  // Purges the hashed-IP rate-limit ledger (see 0008_checkout_hardening.sql)
  // — it only ever needs to answer "how many checkouts in the last 10
  // minutes", so nothing older than a day has any remaining purpose.
  const { error: rateLimitCleanupError } = await supabase
    .from("checkout_rate_limits")
    .delete()
    .lt("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString());
  if (rateLimitCleanupError) {
    console.error("release-expired-reservations: failed to prune checkout_rate_limits", rateLimitCleanupError);
  }

  if (ids.length > 0) {
    console.log(
      `release-expired-reservations: expired ${ids.length} reservation(s), force-expired ${expiredSessionCount} Stripe session(s)`
    );
  }

  return { expired: ids.length, stripeSessionsExpired: expiredSessionCount };
}

export const config: Config = {
  schedule: "*/5 * * * *",
};

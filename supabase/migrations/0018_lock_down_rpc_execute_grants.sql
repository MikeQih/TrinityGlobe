-- -----------------------------------------------------------------------
-- Full RLS/admin-app permission audit (see PROJECT_STATUS.md, "第十轮").
-- Real cross-user RLS testing (two throwaway auth accounts, direct
-- supabase-js calls with their own JWTs) found NO exploitable cross-user
-- data leak or forgery today — RLS's lack of any customer INSERT/UPDATE
-- policy on orders/inventory/inventory_reservations/refund_requests
-- already blocks every mutation attempt. But every RPC in this schema was
-- still reachable directly from a browser with just the anon key, because
-- Supabase grants EXECUTE on every new `public` schema function to
-- `anon`/`authenticated` by default, and no migration ever revoked it.
-- That's the wrong default for RPCs that are only ever meant to be called
-- from a Netlify Function (using the service_role key) or from a trusted
-- trigger — they should never have been directly callable by a browser at
-- all, regardless of what RLS happens to catch. Concretely:
--   - cancel_pending_order_as_staff and settle_refund_request/
--     claim_refund_request have NO internal caller-role check of their
--     own — they trust whichever Netlify Function calls them
--     (admin-cancel-order.ts / admin-refund-order.ts) to have already
--     checked admin_profiles.role. A direct RPC call bypasses that check
--     entirely; only the underlying table's RLS (no write policy at all
--     for refund_requests, staff-only UPDATE for orders) currently saves
--     it.
--   - cancel_own_pending_order and set_default_customer_address take a
--     p_user_id parameter and compare it against the row's real owner —
--     correct when called from a Netlify Function with a server-verified
--     user id, but if called directly, the *only* thing stopping an
--     attacker from passing someone else's user_id is RLS filtering the
--     initial `for update` row lock down to zero rows before the
--     ownership check is even reached.
-- Least privilege says these should simply not be reachable by anon/
-- authenticated in the first place — RLS should be a second layer, not
-- the only one standing between a browser and these RPCs.
-- -----------------------------------------------------------------------

-- 1. `create_pending_order` accumulated four stale overloads across
--    0002/0005/0007/0008 — each migration that added a parameter changed
--    the function's signature instead of matching the previous one
--    exactly, so `create or replace` created a new overload rather than
--    replacing the old one. All four pre-0017 versions are still live and
--    still fully callable (missing the GST-effective-date logic, the
--    checkout rate-limiting added in 0008, or both). Drop everything
--    except the current signature (identified by the GST columns 0017
--    added, which only the current version has).
do $$
declare
  r record;
begin
  for r in
    select pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_pending_order'
      and pg_get_function_identity_arguments(p.oid) not like '%p_gst_registered_at_checkout%'
  loop
    execute format('drop function public.create_pending_order(%s)', r.args);
  end loop;
end $$;

-- 2. Revoke EXECUTE on every RPC that exists only to be called from a
--    Netlify Function's service_role client. None of these are called
--    directly from browser code anywhere in src/ or admin-app/src/
--    (confirmed by grep) — admin-app itself only ever calls the two admin
--    Netlify Functions (admin-cancel-order.ts, admin-refund-order.ts) for
--    anything these RPCs do, plus a plain `.from("orders").update(...)`
--    for simple status changes, which stays governed by the "ops and
--    admin can update orders" RLS policy as before — nothing here touches
--    that path.
--
--    IMPORTANT: Supabase's default grant on every new function is
--    `GRANT EXECUTE ... TO PUBLIC`, not separate grants to `anon` and
--    `authenticated` — `information_schema.routine_privileges` resolves
--    and *displays* that inherited PUBLIC grant as if each role had its
--    own row, which is what made this easy to miss. Revoking from
--    `anon, authenticated` directly (first attempt at this migration)
--    changed nothing, since both roles kept inheriting EXECUTE straight
--    from PUBLIC regardless. The fix has to revoke from PUBLIC itself,
--    confirmed against `pg_proc.proacl` (the `=X/...` entry is the PUBLIC
--    grant) before and after.
revoke execute on function public.cancel_own_pending_order(uuid, uuid) from public;
revoke execute on function public.cancel_pending_order_as_staff(uuid) from public;
revoke execute on function public.claim_refund_request(uuid, integer, uuid) from public;
revoke execute on function public.confirm_inventory_reservation(uuid) from public;
revoke execute on function public.create_pending_order(
  jsonb, jsonb, text, integer, integer, integer, boolean, numeric, integer, boolean, integer, uuid, uuid, text, text
) from public;
revoke execute on function public.expire_stale_reservations() from public;
revoke execute on function public.get_available_stock(text) from public;
revoke execute on function public.mark_order_failed_from_webhook(uuid, text) from public;
revoke execute on function public.mark_order_paid_from_webhook(uuid, text) from public;
revoke execute on function public.release_inventory_reservation(uuid) from public;
revoke execute on function public.reserve_inventory(text, integer, uuid, integer) from public;
revoke execute on function public.settle_refund_request(uuid, text, text, text) from public;

-- 3. `set_default_customer_address` genuinely is called directly from the
--    browser (src/addresses-page.ts, using the customer's own JWT) — so
--    revoke the PUBLIC grant (which included anon) and re-grant only to
--    `authenticated`.
revoke execute on function public.set_default_customer_address(uuid, uuid) from public;
grant execute on function public.set_default_customer_address(uuid, uuid) to authenticated;

-- 4. `current_admin_role()` is called from inside every staff-facing RLS
--    policy on every table that has one (inventory, orders,
--    order_status_history, refund_requests, ...). Postgres evaluates every
--    permissive policy on a table for every query against it, regardless
--    of which policy would end up being the one that actually matches —
--    so even a plain anonymous `select * from orders` needs to *evaluate*
--    "staff can view orders"'s `current_admin_role() = ANY(...)`, not just
--    "customers can view own orders". An earlier version of this
--    migration revoked `anon`'s EXECUTE here on the theory that anon has
--    no legitimate reason to call it directly — that broke anon reads on
--    every one of those tables outright (`permission denied for function
--    current_admin_role` instead of a clean empty result), caught by
--    re-running the anon read-access tests straight after. `anon` must
--    keep EXECUTE for exactly this reason, even though it will only ever
--    evaluate to null for a real anonymous caller.
revoke execute on function public.current_admin_role() from public;
grant execute on function public.current_admin_role() to authenticated, anon;

-- 5. Trigger functions are never meant to be called as RPCs at all — the
--    trigger mechanism invokes them independently of EXECUTE grants, so
--    revoking here doesn't affect trg_orders_updated_at etc., it just
--    closes an RPC endpoint (POST /rpc/set_updated_at, etc.) that could
--    never do anything useful but shouldn't have existed either.
revoke execute on function public.set_updated_at() from public;
revoke execute on function public.validate_order_status_transition() from public;
revoke execute on function public.log_order_status_initial() from public;
revoke execute on function public.log_order_status_change() from public;

-- 6. Without this, the very next migration that adds a new RPC silently
--    reintroduces the exact same problem — Supabase's project template
--    grants EXECUTE on every new `public` function to PUBLIC by default.
--    Flip that default going forward; a future RPC that genuinely needs
--    to be customer-callable (like set_default_customer_address today)
--    grants it explicitly, same as this migration does above.
alter default privileges in schema public revoke execute on functions from public;

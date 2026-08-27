-- -----------------------------------------------------------------------
-- Adds a per-order language snapshot so the customer confirmation email
-- (and its admin-app resend) goes out in the language the customer was
-- actually browsing the storefront in at checkout — today every customer
-- email is hardcoded English regardless of that. Same snapshot reasoning
-- as recipient_snapshot / gst_registered_at_checkout: the site's language
-- toggle, or a customer switching languages later, must never retroactively
-- change which language an already-placed order's emails go out in. Once
-- set at create_pending_order time, `locale` is never written again by any
-- other code path — resume-checkout-session.ts only re-opens an existing
-- Stripe session and never touches the orders row, and the two staff
-- resend Functions read it back, never overwrite it.
--
-- Existing orders and any missing/invalid value fall back to 'en' — the
-- column is added NOT NULL DEFAULT 'en', which Postgres backfills onto
-- every pre-existing row in the same statement, and the CHECK constraint
-- means only 'en'/'zh' can ever be stored going forward.
-- -----------------------------------------------------------------------
alter table orders add column locale text not null default 'en' check (locale in ('en', 'zh'));

-- create_pending_order accumulated 4 stale overloads the last time a
-- parameter was added (0002/0005/0007/0008, cleaned up in 0018) because
-- `create or replace function` only replaces a function when its argument
-- *types* match exactly — a changed parameter list creates a brand new
-- overload instead of replacing the old one, silently leaving the old,
-- less-validated version fully callable. Drop every existing overload by
-- introspection (not a hardcoded signature) before recreating, so this
-- can't happen again regardless of what's actually live right now.
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
  loop
    execute format('drop function public.create_pending_order(%s)', r.args);
  end loop;
end $$;

create function create_pending_order(
  p_items jsonb,
  p_recipient jsonb,
  p_delivery_method text,
  p_subtotal_cents integer,
  p_shipping_fee_cents integer,
  p_gst_cents integer,
  p_gst_registered_at_checkout boolean,
  p_gst_rate numeric,
  p_total_cents integer,
  p_age_confirmed boolean,
  p_locale text default 'en',
  p_reservation_ttl_minutes integer default 30,
  p_user_id uuid default null,
  p_checkout_attempt_id uuid default null,
  p_ip_hash text default null,
  p_checkout_fingerprint text default null
) returns orders
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_order orders;
  v_item jsonb;
  v_email text;
  v_pending_count integer;
  v_ip_count integer;
  v_locale text;
begin
  -- Belt-and-braces on top of create-checkout-session.ts's own validation:
  -- this RPC's EXECUTE is restricted to service_role (see below), but a
  -- future bug in the caller should still never be able to write a locale
  -- value the email templates don't understand.
  v_locale := case when p_locale in ('en', 'zh') then p_locale else 'en' end;

  v_email := p_recipient ->> 'email';

  perform pg_advisory_xact_lock(hashtext('checkout_email:' || v_email));

  select count(*) into v_pending_count
  from public.orders
  where status = 'pending_payment'
    and recipient_snapshot ->> 'email' = v_email
    and created_at > now() - make_interval(mins => p_reservation_ttl_minutes);
  if v_pending_count >= 3 then
    raise exception 'rate_limited_email' using errcode = 'P0001';
  end if;

  if p_ip_hash is not null then
    perform pg_advisory_xact_lock(hashtext('checkout_ip:' || p_ip_hash));

    select count(*) into v_ip_count
    from public.checkout_rate_limits
    where ip_hash = p_ip_hash
      and created_at > now() - interval '10 minutes';
    if v_ip_count >= 5 then
      raise exception 'rate_limited_ip' using errcode = 'P0001';
    end if;

    insert into public.checkout_rate_limits (ip_hash) values (p_ip_hash);
  end if;

  insert into public.orders (
    recipient_snapshot, delivery_method, age_confirmed,
    subtotal_cents, shipping_fee_cents, gst_cents, gst_registered_at_checkout, gst_rate,
    total_cents, locale, user_id, checkout_attempt_id, checkout_fingerprint
  )
  values (
    p_recipient, p_delivery_method, p_age_confirmed,
    p_subtotal_cents, p_shipping_fee_cents, p_gst_cents, p_gst_registered_at_checkout, p_gst_rate,
    p_total_cents, v_locale, p_user_id, p_checkout_attempt_id, p_checkout_fingerprint
  )
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (order_id, sku, name_snapshot, unit_price_cents, qty, line_total_cents)
    values (
      v_order.id,
      v_item ->> 'sku',
      v_item ->> 'nameSnapshot',
      (v_item ->> 'unitPriceCents')::integer,
      (v_item ->> 'qty')::integer,
      (v_item ->> 'lineTotalCents')::integer
    );

    perform public.reserve_inventory(
      v_item ->> 'sku',
      (v_item ->> 'qty')::integer,
      v_order.id,
      p_reservation_ttl_minutes
    );
  end loop;

  return v_order;
end;
$$;

-- 0018's `alter default privileges ... revoke execute on functions from
-- public` already makes this newly-created function default to no PUBLIC
-- grant — this explicit revoke is a redundant, self-documenting belt on
-- top of that. Verified afterward against pg_proc.proacl directly rather
-- than trusted blindly (see PROJECT_STATUS.md for the query used).
revoke execute on function public.create_pending_order(
  jsonb, jsonb, text, integer, integer, integer, boolean, numeric, integer, boolean, text, integer, uuid, uuid, text, text
) from public;

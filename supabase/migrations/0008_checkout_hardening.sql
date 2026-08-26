-- -----------------------------------------------------------------------
-- Hardens checkout against a set of real gaps found reviewing
-- 0007_checkout_idempotency.sql:
--
-- 1. Reverses migration 0007's `orders.ip_address` (a raw IP attached to a
--    row that already carries name/phone/email/address is exactly the kind
--    of data PDPA calls out — collect no more than necessary, keep no
--    longer than necessary). Replaced with checkout_rate_limits, a
--    separate table keyed by a salted hash of the IP, meant to be purged
--    after a day (see release-expired-reservations.ts) — nothing here
--    lets anyone reconstruct the actual address from what's stored.
-- 2. Adds `checkout_fingerprint` so a reused checkout_attempt_id can be
--    verified to still describe the same cart before its session is
--    handed back — see create-checkout-session.ts.
-- 3. Moves the pending-orders-per-email and orders-per-IP-hash counting
--    into create_pending_order itself, behind advisory locks keyed by
--    email/IP-hash. The previous approach (count in application code,
--    then insert) has a TOCTOU race: N concurrent requests can all see
--    "under the limit" before any of them commits. Advisory locks
--    serialize concurrent attempts for the *same* email or IP without
--    taking a table-wide lock that would slow down unrelated checkouts.
-- 4. Adds `payment_review` and `expired` order statuses, and two RPCs
--    (mark_order_paid_from_webhook / mark_order_failed_from_webhook) that
--    make "check current status, then transition it, then touch
--    reservations" a single atomic call instead of three separate
--    round-trips from stripe-webhook.ts — closes the race where two
--    webhook deliveries for the same order processed concurrently could
--    interleave. payment_review is a deliberate dead-end for the cases
--    that can't be resolved automatically without risking either an
--    overwritten paid order or stock that's already been sold twice —
--    see the RPC bodies below for exactly which cases land there.
-- -----------------------------------------------------------------------

-- Looked up by definition rather than a hardcoded name — Postgres
-- auto-names an inline CHECK constraint, and depending on how it landed in
-- 0001_init.sql that name isn't guaranteed to be predictable.
do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'orders'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%pending_payment%';
  if v_constraint_name is not null then
    execute format('alter table orders drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table orders add constraint orders_status_check check (status in (
  'pending_payment', 'paid', 'preparing',
  'ready_for_collection', 'out_for_delivery',
  'completed', 'cancelled', 'refunded',
  'payment_failed', 'payment_review', 'expired'
));

drop index if exists idx_orders_ip_address_created_at;
alter table orders drop column if exists ip_address;
alter table orders add column checkout_fingerprint text;

-- Deliberately not a foreign key to anything and deliberately short-lived —
-- this table exists only to answer "how many checkouts from this IP
-- recently", nothing else. ip_hash is HMAC-SHA256(ip, a server-side secret
-- never stored in the database), computed in create-checkout-session.ts, so
-- even full read access to this table doesn't recover the original IP.
create table checkout_rate_limits (
  id          bigint generated always as identity primary key,
  ip_hash     text not null,
  created_at  timestamptz not null default now()
);

create index idx_checkout_rate_limits_ip_hash_created_at on checkout_rate_limits(ip_hash, created_at);
create index idx_checkout_rate_limits_created_at on checkout_rate_limits(created_at);

-- create_pending_order now takes p_checkout_fingerprint/p_ip_hash instead of
-- the old p_ip_address, and does its own rate limiting atomically instead
-- of trusting a count already done by the caller.
create or replace function create_pending_order(
  p_items jsonb,
  p_recipient jsonb,
  p_delivery_method text,
  p_subtotal_cents integer,
  p_shipping_fee_cents integer,
  p_gst_cents integer,
  p_total_cents integer,
  p_age_confirmed boolean,
  p_reservation_ttl_minutes integer default 30,
  p_user_id uuid default null,
  p_checkout_attempt_id uuid default null,
  p_ip_hash text default null,
  p_checkout_fingerprint text default null
) returns orders
language plpgsql as $$
declare
  v_order orders;
  v_item jsonb;
  v_email text;
  v_pending_count integer;
  v_ip_count integer;
begin
  v_email := p_recipient ->> 'email';

  -- Serializes concurrent attempts for the same email so the count check
  -- below can't race — held for the rest of this transaction.
  perform pg_advisory_xact_lock(hashtext('checkout_email:' || v_email));

  select count(*) into v_pending_count
  from orders
  where status = 'pending_payment'
    and recipient_snapshot ->> 'email' = v_email
    and created_at > now() - make_interval(mins => p_reservation_ttl_minutes);
  if v_pending_count >= 3 then
    raise exception 'rate_limited_email' using errcode = 'P0001';
  end if;

  if p_ip_hash is not null then
    perform pg_advisory_xact_lock(hashtext('checkout_ip:' || p_ip_hash));

    select count(*) into v_ip_count
    from checkout_rate_limits
    where ip_hash = p_ip_hash
      and created_at > now() - interval '10 minutes';
    if v_ip_count >= 5 then
      raise exception 'rate_limited_ip' using errcode = 'P0001';
    end if;

    insert into checkout_rate_limits (ip_hash) values (p_ip_hash);
  end if;

  insert into orders (
    recipient_snapshot, delivery_method, age_confirmed,
    subtotal_cents, shipping_fee_cents, gst_cents, total_cents, user_id,
    checkout_attempt_id, checkout_fingerprint
  )
  values (
    p_recipient, p_delivery_method, p_age_confirmed,
    p_subtotal_cents, p_shipping_fee_cents, p_gst_cents, p_total_cents, p_user_id,
    p_checkout_attempt_id, p_checkout_fingerprint
  )
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into order_items (order_id, sku, name_snapshot, unit_price_cents, qty, line_total_cents)
    values (
      v_order.id,
      v_item ->> 'sku',
      v_item ->> 'nameSnapshot',
      (v_item ->> 'unitPriceCents')::integer,
      (v_item ->> 'qty')::integer,
      (v_item ->> 'lineTotalCents')::integer
    );

    -- Raises 'insufficient_stock' on failure, which aborts this entire
    -- function call (see comment above).
    perform reserve_inventory(
      v_item ->> 'sku',
      (v_item ->> 'qty')::integer,
      v_order.id,
      p_reservation_ttl_minutes
    );
  end loop;

  return v_order;
end;
$$;

-- Called from stripe-webhook.ts's handlePaymentSucceeded. Returns which of
-- three things happened, so the caller knows whether to actually send
-- confirmation emails (only on 'paid_now') or not (a redelivered/duplicate
-- event, or an anomaly that needs a human):
--   'paid_now'       — genuinely transitioned pending_payment -> paid here.
--   'already_paid'   — no-op, this order was already paid (safe redelivery).
--   'payment_review' — Stripe says this payment succeeded, but our order
--                       wasn't sitting at pending_payment anymore (e.g. an
--                       earlier, wrongly-ordered webhook already marked it
--                       payment_failed/expired/cancelled, and its stock may
--                       already have been released and resold). Confirming
--                       the reservation now could oversell; silently
--                       leaving it payment_failed would mean Stripe has the
--                       customer's money for an order we're treating as
--                       dead. Neither is safe to pick automatically, so
--                       this is a deliberate dead end for a human to
--                       resolve (refund, or manually confirm if the stock
--                       happens to still be available).
create function mark_order_paid_from_webhook(
  p_order_id uuid,
  p_payment_intent_id text
) returns text
language plpgsql as $$
declare
  v_status text;
  v_res_id uuid;
begin
  select status into v_status from orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;

  if v_status = 'paid' then
    return 'already_paid';
  end if;

  if v_status <> 'pending_payment' then
    update orders set status = 'payment_review' where id = p_order_id;
    return 'payment_review';
  end if;

  for v_res_id in
    select id from inventory_reservations where order_id = p_order_id and status = 'pending'
  loop
    perform confirm_inventory_reservation(v_res_id);
  end loop;

  update orders
  set status = 'paid', paid_at = now(), stripe_payment_intent_id = p_payment_intent_id
  where id = p_order_id;

  return 'paid_now';
end;
$$;

-- Called from stripe-webhook.ts's handlePaymentFailed for both
-- checkout.session.expired (p_new_status = 'expired') and
-- checkout.session.async_payment_failed (p_new_status = 'payment_failed').
-- Only ever transitions FROM pending_payment — if the order is already
-- paid/refunded/cancelled/payment_review/etc., this is a no-op that
-- returns the order's actual current status unchanged, so a late/
-- out-of-order failure or expiry event can never undo a real payment or
-- clobber a status set by something else in the meantime.
create function mark_order_failed_from_webhook(
  p_order_id uuid,
  p_new_status text default 'payment_failed'
) returns text
language plpgsql as $$
declare
  v_status text;
  v_res_id uuid;
begin
  if p_new_status not in ('payment_failed', 'expired') then
    raise exception 'invalid_new_status: %', p_new_status using errcode = 'P0001';
  end if;

  select status into v_status from orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;

  if v_status <> 'pending_payment' then
    return v_status;
  end if;

  for v_res_id in
    select id from inventory_reservations where order_id = p_order_id and status in ('pending', 'confirmed')
  loop
    perform release_inventory_reservation(v_res_id);
  end loop;

  update orders set status = p_new_status where id = p_order_id;
  return p_new_status;
end;
$$;

-- Called from a signed-in customer's "Cancel order" action (My Orders) and
-- from resume-checkout-session.ts when a customer's own attempt to resume
-- payment finds the order no longer cancellable. p_user_id must match the
-- order's owner — ownership is re-verified here, not just trusted from
-- whatever the client claims. Only cancellable from pending_payment, same
-- reasoning as mark_order_failed_from_webhook above.
create function cancel_own_pending_order(
  p_order_id uuid,
  p_user_id uuid
) returns text
language plpgsql as $$
declare
  v_status text;
  v_owner uuid;
  v_res_id uuid;
begin
  select status, user_id into v_status, v_owner from orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if v_owner is distinct from p_user_id then
    raise exception 'not_order_owner';
  end if;

  if v_status <> 'pending_payment' then
    return v_status;
  end if;

  for v_res_id in
    select id from inventory_reservations where order_id = p_order_id and status in ('pending', 'confirmed')
  loop
    perform release_inventory_reservation(v_res_id);
  end loop;

  update orders set status = 'cancelled' where id = p_order_id;
  return 'cancelled';
end;
$$;

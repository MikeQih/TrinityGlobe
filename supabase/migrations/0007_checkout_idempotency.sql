-- -----------------------------------------------------------------------
-- Two additions to harden checkout against abuse and accidental retries
-- (double-click, slow network retry, browser back/resubmit):
--
-- 1. checkout_attempt_id: a UUID the client generates once per checkout
--    form visit (see src/cart.ts) and sends with every create-checkout-
--    session request for that visit. Unique when set, so a retry with the
--    same id can never insert a second order — create-checkout-session.ts
--    checks for an existing row with this id first and reuses its Stripe
--    session instead of creating a new one.
-- 2. ip_address: the requester's IP at order-creation time, used by
--    create-checkout-session.ts to rate-limit how many orders a single IP
--    can create in a short window. Not a reservation/payment concern by
--    itself — purely an abuse signal.
-- -----------------------------------------------------------------------
alter table orders add column checkout_attempt_id uuid;
alter table orders add column ip_address text;

create unique index idx_orders_checkout_attempt_id
  on orders(checkout_attempt_id)
  where checkout_attempt_id is not null;

-- Used by create-checkout-session.ts's IP rate limit — most recent orders
-- from a given IP, regardless of status.
create index idx_orders_ip_address_created_at
  on orders(ip_address, created_at)
  where ip_address is not null;

-- create_pending_order gains two new, defaulted, trailing parameters — safe
-- to `create or replace` without dropping the function (existing callers
-- that don't pass them keep working, same pattern as p_user_id in
-- 0005_orders_customer_link.sql).
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
  p_ip_address text default null
) returns orders
language plpgsql as $$
declare
  v_order orders;
  v_item jsonb;
begin
  insert into orders (
    recipient_snapshot, delivery_method, age_confirmed,
    subtotal_cents, shipping_fee_cents, gst_cents, total_cents, user_id,
    checkout_attempt_id, ip_address
  )
  values (
    p_recipient, p_delivery_method, p_age_confirmed,
    p_subtotal_cents, p_shipping_fee_cents, p_gst_cents, p_total_cents, p_user_id,
    p_checkout_attempt_id, p_ip_address
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

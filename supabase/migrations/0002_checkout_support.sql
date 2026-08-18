-- Adds what's needed to actually place an order (0001_init.sql only defined
-- the inventory/reservation primitives), plus the GST-registration flag the
-- PRD flags as a pending finance decision (PRD §2.3 / §16.2).

alter table store_settings
  add column gst_registered boolean not null default false;

-- Creates an order + its line items + a reservation for every item, all in
-- one transaction: if reserve_inventory() raises for ANY item (insufficient
-- stock), the whole function aborts and Postgres rolls back the order, the
-- items, and any reservations already made earlier in the same call. The
-- Function layer never has to hand-roll compensating cleanup for a
-- half-created order.
create function create_pending_order(
  p_items jsonb,
  p_recipient jsonb,
  p_delivery_method text,
  p_subtotal_cents integer,
  p_shipping_fee_cents integer,
  p_gst_cents integer,
  p_total_cents integer,
  p_age_confirmed boolean,
  p_reservation_ttl_minutes integer default 30
) returns orders
language plpgsql as $$
declare
  v_order orders;
  v_item jsonb;
begin
  insert into orders (
    recipient_snapshot, delivery_method, age_confirmed,
    subtotal_cents, shipping_fee_cents, gst_cents, total_cents
  )
  values (
    p_recipient, p_delivery_method, p_age_confirmed,
    p_subtotal_cents, p_shipping_fee_cents, p_gst_cents, p_total_cents
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

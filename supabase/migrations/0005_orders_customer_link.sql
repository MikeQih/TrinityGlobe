-- -----------------------------------------------------------------------
-- Links an order to the Supabase Auth account that placed it, when the
-- customer was signed in at checkout (guest checkouts leave this null —
-- signing in/up is optional, not required, see src/cart.ts). This is what
-- actually lets a customer see their own past orders (My Orders page) —
-- the Google/Facebook/email login added earlier only got them signed in,
-- it didn't attach anything to their account yet.
-- -----------------------------------------------------------------------
alter table orders add column user_id uuid references auth.users(id) on delete set null;

create index idx_orders_user_id on orders(user_id) where user_id is not null;

-- create_pending_order gains one new, defaulted, trailing parameter — safe
-- to `create or replace` without dropping the function (existing callers
-- that don't pass p_user_id keep working, order just lands as a guest
-- order same as before).
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
  p_user_id uuid default null
) returns orders
language plpgsql as $$
declare
  v_order orders;
  v_item jsonb;
begin
  insert into orders (
    recipient_snapshot, delivery_method, age_confirmed,
    subtotal_cents, shipping_fee_cents, gst_cents, total_cents, user_id
  )
  values (
    p_recipient, p_delivery_method, p_age_confirmed,
    p_subtotal_cents, p_shipping_fee_cents, p_gst_cents, p_total_cents, p_user_id
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

-- Additive alongside the existing "staff can view orders" policy — a row
-- is visible if either policy's condition holds, so this only ever adds
-- visibility (a customer's own orders), never takes any away.
create policy "customers can view own orders"
  on orders for select
  using (user_id = auth.uid());

create policy "customers can view own order items"
  on order_items for select
  using (exists (
    select 1 from orders where orders.id = order_items.order_id and orders.user_id = auth.uid()
  ));

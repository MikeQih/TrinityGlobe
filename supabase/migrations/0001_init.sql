-- Trinity Globe 商城 Phase 1 schema.
-- All money amounts are integer cents (e.g. S$129.90 -> 12990). Never store
-- floating point currency values.
--
-- Design notes:
--   * order_items.sku and inventory_movements.sku are plain text snapshots,
--     not foreign keys to product_variants — historical orders/audit trail
--     must stay intact even if a product is later discontinued and its
--     product_variants row removed.
--   * inventory.sku and inventory_reservations.sku ARE foreign keys, since
--     those only ever reference currently-sellable variants.
--   * order_status_history is populated automatically by triggers (see
--     bottom of file), so application code never has to remember to log it.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- product_variants: transactional fields Supabase owns. Editorial content
-- (name, image, description, category, SEO copy) stays in Netlify CMS /
-- products.json; the two are joined by `sku`.
-- ---------------------------------------------------------------------------
create table product_variants (
  sku                         text primary key,
  name_snapshot               text not null,
  unit_price_cents            integer not null check (unit_price_cents >= 0),
  case_price_cents            integer check (case_price_cents >= 0),
  is_active                   boolean not null default true,
  allow_self_collection       boolean not null default true,
  eligible_for_free_shipping  boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create table inventory (
  sku            text primary key references product_variants(sku) on delete cascade,
  website_stock  integer not null default 0 check (website_stock >= 0),
  shopee_stock   integer not null default 0 check (shopee_stock >= 0),
  safety_stock   integer not null default 0 check (safety_stock >= 0),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- orders / order_items
-- ---------------------------------------------------------------------------
create table orders (
  id                          uuid primary key default gen_random_uuid(),
  status                      text not null default 'pending_payment'
                               check (status in (
                                 'pending_payment', 'paid', 'preparing',
                                 'ready_for_collection', 'out_for_delivery',
                                 'completed', 'cancelled', 'refunded',
                                 'payment_failed'
                               )),
  -- Guest checkout: no customers/addresses table in Phase 1, the recipient
  -- details are captured as a point-in-time snapshot on the order itself.
  recipient_snapshot          jsonb not null, -- { name, phone, email, address, postal_code, notes }
  delivery_method             text not null check (delivery_method in ('standard', 'self_collection')),
  age_confirmed               boolean not null default false,
  subtotal_cents              integer not null check (subtotal_cents >= 0),
  shipping_fee_cents          integer not null default 0 check (shipping_fee_cents >= 0),
  gst_cents                   integer not null default 0 check (gst_cents >= 0),
  total_cents                 integer not null check (total_cents >= 0),
  currency                    text not null default 'SGD',
  stripe_checkout_session_id  text,
  stripe_payment_intent_id    text,
  refunded_cents              integer not null default 0 check (refunded_cents >= 0),
  internal_notes              text,
  paid_at                     timestamptz,
  cancelled_at                timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index idx_orders_status on orders(status);
create index idx_orders_stripe_checkout_session_id on orders(stripe_checkout_session_id);

create table order_items (
  id                bigint generated always as identity primary key,
  order_id          uuid not null references orders(id) on delete cascade,
  sku               text not null, -- snapshot, not FK — see file header
  name_snapshot     text not null,
  unit_price_cents  integer not null check (unit_price_cents >= 0),
  qty               integer not null check (qty > 0),
  line_total_cents  integer not null check (line_total_cents >= 0)
);

create index idx_order_items_order_id on order_items(order_id);

-- ---------------------------------------------------------------------------
-- Inventory reservation (prevents overselling the last bottle to two
-- concurrent buyers). Lifecycle: pending -> confirmed | released | expired.
-- ---------------------------------------------------------------------------
create table inventory_reservations (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  sku         text not null references product_variants(sku),
  qty         integer not null check (qty > 0),
  status      text not null default 'pending' check (status in ('pending', 'confirmed', 'released', 'expired')),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index idx_inventory_reservations_sku_pending
  on inventory_reservations(sku)
  where status = 'pending';
create index idx_inventory_reservations_order_id on inventory_reservations(order_id);

create table inventory_movements (
  id                   bigint generated always as identity primary key,
  sku                  text not null, -- snapshot, not FK — see file header
  delta                integer not null, -- positive = added back, negative = deducted
  reason               text not null,
  ref_order_id         uuid references orders(id),
  ref_reservation_id   uuid references inventory_reservations(id),
  created_at           timestamptz not null default now()
);

create index idx_inventory_movements_sku on inventory_movements(sku);

-- ---------------------------------------------------------------------------
-- stripe_events: webhook idempotency ledger. A redelivered webhook for an
-- event_id already in this table is a no-op.
-- ---------------------------------------------------------------------------
create table stripe_events (
  stripe_event_id  text primary key,
  event_type       text not null,
  processed_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- order_status_history: populated by trigger, not application code.
-- ---------------------------------------------------------------------------
create table order_status_history (
  id           bigint generated always as identity primary key,
  order_id     uuid not null references orders(id) on delete cascade,
  from_status  text,
  to_status    text not null,
  changed_by   text not null default 'system',
  changed_at   timestamptz not null default now()
);

create index idx_order_status_history_order_id on order_status_history(order_id);

-- ---------------------------------------------------------------------------
-- admin_profiles: role for staff logging into the order back-office via
-- Supabase Auth. Roles: admin (full access), ops (fulfil orders, refund),
-- finance_readonly (view only).
-- ---------------------------------------------------------------------------
create table admin_profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  role          text not null check (role in ('admin', 'ops', 'finance_readonly')),
  display_name  text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- store_settings: single-row config table (shipping fee, free-shipping
-- threshold, GST rate, self-collection info). Seeded with the PRD defaults;
-- update via the admin app once the business confirms final numbers.
-- ---------------------------------------------------------------------------
create table store_settings (
  id                              smallint primary key default 1 check (id = 1),
  standard_shipping_fee_cents     integer not null default 1500,
  free_shipping_threshold_cents   integer not null default 12000,
  gst_rate                        numeric(5, 4) not null default 0.0900,
  self_collection_address         text,
  self_collection_hours           text,
  updated_at                      timestamptz not null default now()
);

insert into store_settings (id) values (1);

-- ---------------------------------------------------------------------------
-- Triggers: updated_at bookkeeping + automatic order_status_history logging.
-- ---------------------------------------------------------------------------
create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_orders_updated_at
  before update on orders
  for each row execute function set_updated_at();

create trigger trg_inventory_updated_at
  before update on inventory
  for each row execute function set_updated_at();

create trigger trg_product_variants_updated_at
  before update on product_variants
  for each row execute function set_updated_at();

create trigger trg_store_settings_updated_at
  before update on store_settings
  for each row execute function set_updated_at();

create function log_order_status_initial() returns trigger
language plpgsql as $$
begin
  insert into order_status_history (order_id, from_status, to_status)
  values (new.id, null, new.status);
  return new;
end;
$$;

create trigger trg_order_status_history_insert
  after insert on orders
  for each row execute function log_order_status_initial();

create function log_order_status_change() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    insert into order_status_history (order_id, from_status, to_status)
    values (new.id, old.status, new.status);
  end if;
  return new;
end;
$$;

create trigger trg_order_status_history_update
  after update on orders
  for each row execute function log_order_status_change();

-- ---------------------------------------------------------------------------
-- RPCs: the only supported way to change inventory. All three run inside a
-- single statement's implicit transaction and take a row lock via
-- `for update` so two concurrent checkouts can never both succeed for the
-- last bottle.
-- ---------------------------------------------------------------------------

-- Reserve stock for a not-yet-paid order. Raises 'insufficient_stock' if the
-- requested quantity isn't available (accounting for other still-pending
-- reservations). Does NOT touch inventory.website_stock — a reservation
-- alone doesn't change real stock, it only carves out a hold against it;
-- website_stock is only decremented when the reservation is confirmed.
create function reserve_inventory(
  p_sku text,
  p_qty integer,
  p_order_id uuid,
  p_ttl_minutes integer default 30
) returns inventory_reservations
language plpgsql as $$
declare
  v_website_stock  integer;
  v_reserved       integer;
  v_available      integer;
  v_reservation    inventory_reservations;
begin
  if p_qty <= 0 then
    raise exception 'invalid_qty' using errcode = 'P0001';
  end if;

  select website_stock into v_website_stock
  from inventory
  where sku = p_sku
  for update;

  if not found then
    raise exception 'unknown_sku: %', p_sku using errcode = 'P0001';
  end if;

  select coalesce(sum(qty), 0) into v_reserved
  from inventory_reservations
  where sku = p_sku
    and status = 'pending'
    and expires_at > now();

  v_available := v_website_stock - v_reserved;

  if v_available < p_qty then
    raise exception 'insufficient_stock' using errcode = 'P0001';
  end if;

  insert into inventory_reservations (order_id, sku, qty, status, expires_at)
  values (p_order_id, p_sku, p_qty, 'pending', now() + make_interval(mins => p_ttl_minutes))
  returning * into v_reservation;

  return v_reservation;
end;
$$;

-- Convert a pending reservation into a real stock deduction. Called from the
-- Stripe webhook once payment has actually succeeded. Idempotent: calling it
-- again on an already-confirmed reservation is a silent no-op, since the
-- webhook may be redelivered even though stripe_events already guards most
-- of that at the application layer.
create function confirm_inventory_reservation(p_reservation_id uuid) returns void
language plpgsql as $$
declare
  v_res inventory_reservations;
begin
  select * into v_res
  from inventory_reservations
  where id = p_reservation_id
  for update;

  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0001';
  end if;

  if v_res.status = 'confirmed' then
    return; -- already applied, nothing to do
  end if;

  if v_res.status <> 'pending' then
    raise exception 'reservation_not_pending: %', v_res.status using errcode = 'P0001';
  end if;

  update inventory
  set website_stock = website_stock - v_res.qty
  where sku = v_res.sku;

  update inventory_reservations
  set status = 'confirmed'
  where id = p_reservation_id;

  insert into inventory_movements (sku, delta, reason, ref_order_id, ref_reservation_id)
  values (v_res.sku, -v_res.qty, 'reservation_confirmed', v_res.order_id, v_res.id);
end;
$$;

-- Release a reservation without a completed payment: payment failed, the
-- customer abandoned checkout, or an already-paid order was later cancelled
-- and refunded. If the reservation had already been confirmed (stock really
-- was deducted), this restocks it; if it was still pending, nothing was ever
-- deducted so there's nothing to restock. Idempotent on already-released or
-- already-expired reservations.
create function release_inventory_reservation(p_reservation_id uuid) returns void
language plpgsql as $$
declare
  v_res inventory_reservations;
begin
  select * into v_res
  from inventory_reservations
  where id = p_reservation_id
  for update;

  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0001';
  end if;

  if v_res.status in ('released', 'expired') then
    return; -- already handled, no-op
  end if;

  if v_res.status = 'confirmed' then
    update inventory
    set website_stock = website_stock + v_res.qty
    where sku = v_res.sku;

    insert into inventory_movements (sku, delta, reason, ref_order_id, ref_reservation_id)
    values (v_res.sku, v_res.qty, 'reservation_released_after_confirm', v_res.order_id, v_res.id);
  end if;

  update inventory_reservations
  set status = 'released'
  where id = p_reservation_id;
end;
$$;

-- Called on a schedule (see netlify/functions/release-expired-reservations.ts)
-- to flip overdue pending reservations to 'expired'. Pending reservations
-- never touched website_stock, so this is just a status flip, not a restock.
create function expire_stale_reservations() returns setof uuid
language sql as $$
  update inventory_reservations
  set status = 'expired'
  where status = 'pending'
    and expires_at <= now()
  returning id;
$$;

-- Convenience read used by the products-live Function: real-time sellable
-- stock is website_stock minus whatever's currently held by pending
-- reservations.
create function get_available_stock(p_sku text) returns integer
language sql stable as $$
  select i.website_stock - coalesce((
    select sum(r.qty)
    from inventory_reservations r
    where r.sku = p_sku and r.status = 'pending' and r.expires_at > now()
  ), 0)
  from inventory i
  where i.sku = p_sku;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security. Netlify Functions authenticate with the service_role
-- key, which bypasses RLS entirely — the policies below only govern the
-- admin back-office app, which authenticates real staff via Supabase Auth.
-- ---------------------------------------------------------------------------
alter table product_variants enable row level security;
alter table inventory enable row level security;
alter table inventory_reservations enable row level security;
alter table inventory_movements enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_status_history enable row level security;
alter table stripe_events enable row level security;
alter table admin_profiles enable row level security;
alter table store_settings enable row level security;

create function current_admin_role() returns text
language sql stable security definer set search_path = public as $$
  select role from admin_profiles where user_id = auth.uid();
$$;

create policy "staff can view own admin profile"
  on admin_profiles for select
  using (user_id = auth.uid());

create policy "admins manage admin profiles"
  on admin_profiles for all
  using (current_admin_role() = 'admin')
  with check (current_admin_role() = 'admin');

create policy "staff can view orders"
  on orders for select
  using (current_admin_role() in ('admin', 'ops', 'finance_readonly'));

create policy "ops and admin can update orders"
  on orders for update
  using (current_admin_role() in ('admin', 'ops'))
  with check (current_admin_role() in ('admin', 'ops'));

create policy "staff can view order items"
  on order_items for select
  using (current_admin_role() in ('admin', 'ops', 'finance_readonly'));

create policy "staff can view order status history"
  on order_status_history for select
  using (current_admin_role() in ('admin', 'ops', 'finance_readonly'));

create policy "staff can view inventory"
  on inventory for select
  using (current_admin_role() in ('admin', 'ops', 'finance_readonly'));

create policy "staff can view inventory reservations"
  on inventory_reservations for select
  using (current_admin_role() in ('admin', 'ops', 'finance_readonly'));

create policy "staff can view inventory movements"
  on inventory_movements for select
  using (current_admin_role() in ('admin', 'ops', 'finance_readonly'));

create policy "staff can view product variants"
  on product_variants for select
  using (current_admin_role() in ('admin', 'ops', 'finance_readonly'));

create policy "admin can manage store settings"
  on store_settings for all
  using (current_admin_role() = 'admin')
  with check (current_admin_role() = 'admin');

create policy "staff can view store settings"
  on store_settings for select
  using (current_admin_role() in ('admin', 'ops', 'finance_readonly'));

-- No policies on stripe_events: it's an internal webhook ledger the admin
-- app never needs to read, and only service_role (which bypasses RLS)
-- writes to it.

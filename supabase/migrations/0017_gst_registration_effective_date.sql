-- -----------------------------------------------------------------------
-- Replaces the manually-flipped store_settings.gst_registered boolean
-- with the actual facts IRAS issues on registration: an effective date
-- and a registration number. Per IRAS rules, a business may only charge
-- GST from its registration's effective date onward — a boolean someone
-- has to remember to flip on the right day is exactly the kind of thing
-- that drifts out of sync with reality. "Is GST active right now" becomes
-- a single derived check (gst_registration_effective_at is set and not in
-- the future) instead of a second, independently-set flag.
--
-- Also adds a per-order snapshot of the GST facts as they stood at
-- checkout time (gst_registered_at_checkout, gst_rate) — the same
-- reasoning as recipient_snapshot: store_settings can change after an
-- order is placed (registration takes effect, the rate changes), and a
-- historical order's tax status must never be silently reinterpreted by
-- that later change. gst_cents already existed and already gets computed
-- as 0 whenever GST wasn't active (see src/pricing.ts#computeInclusiveGstCents),
-- so no historical order will ever show a non-zero GST amount for a
-- period when the business wasn't actually registered to collect it.
-- -----------------------------------------------------------------------
alter table store_settings add column gst_registration_effective_at timestamptz;
alter table store_settings add column gst_registration_number text;
alter table store_settings drop column gst_registered;

alter table orders add column gst_registered_at_checkout boolean not null default false;
alter table orders add column gst_rate numeric(5, 4) not null default 0;

create or replace function create_pending_order(
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
    subtotal_cents, shipping_fee_cents, gst_cents, gst_registered_at_checkout, gst_rate,
    total_cents, user_id, checkout_attempt_id, checkout_fingerprint
  )
  values (
    p_recipient, p_delivery_method, p_age_confirmed,
    p_subtotal_cents, p_shipping_fee_cents, p_gst_cents, p_gst_registered_at_checkout, p_gst_rate,
    p_total_cents, p_user_id, p_checkout_attempt_id, p_checkout_fingerprint
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

-- -----------------------------------------------------------------------
-- Replaces the client-generated-UUID-per-click idempotency key with a
-- persisted refund intent ledger. The per-click key only ever protected
-- against a double-click of the exact same click on the exact same page —
-- it did nothing for a request that timed out with the outcome unknown, a
-- page refresh followed by a retry, two admin-app tabs, or two different
-- staff members refunding the same order at the same time. All four of
-- those generate a *new* key under the old scheme, which Stripe treats as
-- a genuinely new refund.
--
-- The fix: every refund *intent* gets one durable row here, and its own
-- id — not something regenerated per click — is what gets used as the
-- Stripe idempotency key. A retry (network timeout, page refresh, another
-- tab) reuses the same still-`pending` row and therefore the same key,
-- which is exactly what Stripe's own docs recommend for an ambiguous
-- outcome: retry with the same key rather than a new one. claim_refund_
-- request takes a row lock on the order for the (brief) duration of
-- deciding "is there already a pending attempt, or do I create one" —
-- long enough to serialize two concurrent admins, short enough to never
-- hold a lock across the actual Stripe HTTP call.
-- -----------------------------------------------------------------------
create table refund_requests (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id),
  amount_cents  integer not null check (amount_cents > 0),
  status        text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  stripe_refund_id text,
  failure_reason   text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_refund_requests_order_id on refund_requests(order_id);

alter table refund_requests enable row level security;

create policy "staff can view refund requests"
  on refund_requests for select
  using (current_admin_role() in ('admin', 'ops', 'finance_readonly'));

create trigger trg_refund_requests_updated_at
  before update on refund_requests
  for each row execute function set_updated_at();

-- Claims (or resumes) a refund intent for an order, atomically. Called
-- before ever talking to Stripe.
--   - If a 'pending' request already exists for this order, that request
--     is returned as-is (resumed) rather than creating a second one — the
--     caller is expected to retry Stripe with *this* row's id as the
--     idempotency key, not mint a new one.
--   - p_amount_cents = null means "refund whatever's left" — resolved
--     from the order's own remaining balance inside this same lock, never
--     computed by the caller beforehand (that would reopen the exact
--     race this function exists to close).
create function claim_refund_request(
  p_order_id uuid,
  p_amount_cents integer default null,
  p_created_by uuid default null
) returns refund_requests
language plpgsql as $$
declare
  v_order public.orders;
  v_existing public.refund_requests;
  v_remaining integer;
  v_amount integer;
  v_new public.refund_requests;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if v_order.stripe_payment_intent_id is null then
    raise exception 'no_payment';
  end if;

  select * into v_existing
  from public.refund_requests
  where order_id = p_order_id and status = 'pending'
  limit 1
  for update;

  if found then
    if p_amount_cents is not null and v_existing.amount_cents <> p_amount_cents then
      raise exception 'pending_refund_amount_mismatch';
    end if;
    return v_existing;
  end if;

  v_remaining := v_order.total_cents - v_order.refunded_cents;
  if v_remaining <= 0 then
    raise exception 'already_refunded';
  end if;

  v_amount := coalesce(p_amount_cents, v_remaining);
  if v_amount > v_remaining then
    raise exception 'amount_too_large';
  end if;

  insert into public.refund_requests (order_id, amount_cents, created_by)
  values (p_order_id, v_amount, p_created_by)
  returning * into v_new;

  return v_new;
end;
$$;

-- Records the outcome of actually calling Stripe for a claimed request.
-- A no-op if the request isn't 'pending' anymore (e.g. a concurrent
-- settle already landed) rather than an error — settling is idempotent
-- on purpose, since the caller may retry this too.
create function settle_refund_request(
  p_refund_request_id uuid,
  p_outcome text,
  p_stripe_refund_id text default null,
  p_failure_reason text default null
) returns void
language plpgsql as $$
declare
  v_req public.refund_requests;
  v_new_refunded_cents integer;
begin
  if p_outcome not in ('succeeded', 'failed') then
    raise exception 'invalid_outcome: %', p_outcome;
  end if;

  select * into v_req from public.refund_requests where id = p_refund_request_id for update;
  if not found then
    raise exception 'refund_request_not_found';
  end if;
  if v_req.status <> 'pending' then
    return;
  end if;

  update public.refund_requests
  set status = p_outcome, stripe_refund_id = p_stripe_refund_id, failure_reason = p_failure_reason
  where id = p_refund_request_id;

  if p_outcome = 'succeeded' then
    select refunded_cents + v_req.amount_cents into v_new_refunded_cents
    from public.orders where id = v_req.order_id;

    update public.orders
    set refunded_cents = v_new_refunded_cents,
        status = case when v_new_refunded_cents >= total_cents then 'refunded' else status end
    where id = v_req.order_id;
  end if;
end;
$$;

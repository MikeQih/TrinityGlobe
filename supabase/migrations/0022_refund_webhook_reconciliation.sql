-- -----------------------------------------------------------------------
-- Fixes the PayNow-async-refund gap found during the Restricted Key
-- rehearsal: admin-refund-order.ts never inspected the Stripe Refund
-- object's own `status` field — any non-throwing response from
-- `refunds.create` (including a PayNow refund that's merely `pending`,
-- or one that needs `requires_action`) was immediately settled as
-- `succeeded`, permanently and irreversibly incrementing
-- `orders.refunded_cents` before Stripe had actually confirmed anything.
-- `stripe-webhook.ts` also never subscribed to `refund.updated` /
-- `refund.failed`, so even if the code had waited, there was nowhere for
-- the real outcome to land.
--
-- This migration replaces `settle_refund_request` (succeeded/failed only,
-- callable exactly once per outcome with no protection against a stale
-- call moving a row backwards) with two narrower, composable functions:
--
--   * bind_refund_stripe_id — a single-purpose write that records which
--     Stripe Refund a pending request produced, without touching status
--     or orders.refunded_cents at all. Called immediately after
--     `refunds.create` returns, before its `status` is even interpreted,
--     so a crash between "Stripe created the refund" and "we decided
--     what to do about it" still leaves the linkage on disk — a human
--     (or a later webhook, via the refund's own metadata) can find it.
--
--   * apply_refund_status — the actual state machine. Takes whatever
--     status a caller has in hand (the synchronous response from
--     `refunds.create`, or an event from stripe-webhook.ts) and applies
--     it under a row lock with two invariants that hold no matter how
--     many times, in what order, or from how many different callers it's
--     invoked for the same refund_requests row:
--       1. `succeeded` and `failed` are true terminal states — once a row
--          reaches either one, every later call becomes a no-op ('noop_
--          already_succeeded' / 'noop_already_failed' for a repeat of the
--          same terminal, 'noop_stale' for anything else, e.g. a `pending`
--          event that was simply in flight before the terminal one and
--          arrived after it). Nothing can move a row backwards out of a
--          terminal state.
--       2. `orders.refunded_cents` is only ever incremented on the single
--          transition *into* `succeeded` — a row can only make that
--          transition once, because the row lock plus invariant 1 means
--          every other caller either finds it already `succeeded` (no-op)
--          or already `failed` (no-op, can't reach `succeeded` from
--          there). Two different Stripe event ids reporting the same
--          refund's success, or the same event redelivered, both collapse
--          into the same single increment.
-- -----------------------------------------------------------------------

alter table refund_requests
  drop constraint refund_requests_status_check;

alter table refund_requests
  add constraint refund_requests_status_check
  check (status in ('pending', 'requires_action', 'succeeded', 'failed'));

-- claim_refund_request originally only resumed an existing 'pending' row,
-- because 'requires_action' didn't exist yet as a status a row could be
-- in. Left unchanged, a retry while a refund sits in 'requires_action'
-- would fail to find it here and create a *second*, parallel
-- refund_requests row for the same remaining balance instead of resuming
-- the first — exactly the double-refund-intent problem this table exists
-- to prevent. 'requires_action' is just as much "an attempt is already in
-- flight, resume it" as 'pending' is, so it's treated identically here.
create or replace function claim_refund_request(
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
  where order_id = p_order_id and status in ('pending', 'requires_action')
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

-- Stripe's own Refund ids are globally unique, so two different
-- refund_requests rows must never end up pointing at the same one — that
-- would mean either a data-entry bug or (far more concerning) the same
-- Stripe refund being credited against orders.refunded_cents twice via two
-- different rows. NULLs (not yet bound) are explicitly allowed to repeat.
create unique index idx_refund_requests_stripe_refund_id
  on refund_requests (stripe_refund_id)
  where stripe_refund_id is not null;

-- Drop the function this migration replaces. Only netlify/functions/
-- admin-refund-order.ts ever called it (confirmed by grep), and this
-- migration ships in the same commit as that file's rewrite to use
-- apply_refund_status instead, so there's no remaining caller to break.
drop function if exists settle_refund_request(uuid, text, text, text);

-- Records which Stripe Refund a still-pending request produced. Never
-- touches `status` or `orders` — the *outcome* of that refund is
-- apply_refund_status's job, called separately (and possibly much later,
-- from a webhook, on a different invocation of this function entirely).
--
-- Deliberately strict about "still pending": if the row has already moved
-- on (typically because a webhook settled it before this call landed —
-- entirely possible for a Card refund that resolves near-instantly), the
-- caller should treat that as "someone else already handled this" and
-- fall through to apply_refund_status rather than treating the exception
-- as fatal.
create function bind_refund_stripe_id(
  p_refund_request_id uuid,
  p_stripe_refund_id text,
  p_order_id uuid,
  p_amount_cents integer
) returns void
language plpgsql as $$
declare
  v_req refund_requests;
begin
  select * into v_req from refund_requests where id = p_refund_request_id for update;
  if not found then
    raise exception 'refund_request_not_found';
  end if;

  if v_req.order_id <> p_order_id or v_req.amount_cents <> p_amount_cents then
    raise exception 'refund_request_mismatch';
  end if;

  if v_req.stripe_refund_id is not null then
    if v_req.stripe_refund_id = p_stripe_refund_id then
      return; -- idempotent: a retry reusing the same Stripe refund is a no-op
    end if;
    raise exception 'refund_request_already_bound';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'refund_request_not_pending';
  end if;

  update refund_requests set stripe_refund_id = p_stripe_refund_id where id = p_refund_request_id;
end;
$$;

-- The state machine described in the header comment above. `p_stripe_status`
-- is whatever Stripe called it — including 'canceled', which this function
-- treats as a definite failure terminal (same handling as 'failed', just
-- with its own default failure_reason) since Stripe never resurrects a
-- canceled refund.
--
-- p_expected_order_id / p_expected_amount_cents are an optional belt-and-
-- braces check: when supplied, a mismatch against the row's own values
-- returns 'mismatch' and changes nothing (not even an exception — this is
-- meant to be checked by the caller and turned into a "flag for manual
-- review" outcome, not a 500 that makes Stripe retry forever).
create function apply_refund_status(
  p_refund_request_id uuid,
  p_stripe_status text,
  p_stripe_refund_id text default null,
  p_failure_reason text default null,
  p_expected_order_id uuid default null,
  p_expected_amount_cents integer default null
) returns text
language plpgsql as $$
declare
  v_req refund_requests;
  v_target_status text;
  v_reason text;
  v_new_refunded_cents integer;
begin
  if p_stripe_status = 'canceled' then
    v_target_status := 'failed';
    v_reason := coalesce(p_failure_reason, 'Refund canceled');
  elsif p_stripe_status in ('pending', 'requires_action', 'succeeded', 'failed') then
    v_target_status := p_stripe_status;
    v_reason := p_failure_reason;
  else
    raise exception 'invalid_stripe_status: %', p_stripe_status;
  end if;

  select * into v_req from refund_requests where id = p_refund_request_id for update;
  if not found then
    raise exception 'refund_request_not_found';
  end if;

  if p_expected_order_id is not null and v_req.order_id <> p_expected_order_id then
    return 'mismatch';
  end if;
  if p_expected_amount_cents is not null and v_req.amount_cents <> p_expected_amount_cents then
    return 'mismatch';
  end if;
  if p_stripe_refund_id is not null and v_req.stripe_refund_id is not null
     and v_req.stripe_refund_id <> p_stripe_refund_id then
    return 'mismatch';
  end if;

  -- Terminal-state protection (invariant 1 above) — nothing below this
  -- point runs once a row is already succeeded or failed.
  if v_req.status = 'succeeded' then
    if v_target_status = 'succeeded' then
      return 'noop_already_succeeded';
    end if;
    return 'noop_stale';
  end if;
  if v_req.status = 'failed' then
    if v_target_status = 'failed' then
      return 'noop_already_failed';
    end if;
    return 'noop_stale';
  end if;

  -- From here, v_req.status is 'pending' or 'requires_action'.
  if v_target_status in ('pending', 'requires_action') then
    update refund_requests
    set status = v_target_status,
        stripe_refund_id = coalesce(p_stripe_refund_id, stripe_refund_id)
    where id = p_refund_request_id;
    return 'applied_' || v_target_status;
  end if;

  if v_target_status = 'failed' then
    update refund_requests
    set status = 'failed',
        stripe_refund_id = coalesce(p_stripe_refund_id, stripe_refund_id),
        failure_reason = v_reason
    where id = p_refund_request_id;
    return 'applied_failed';
  end if;

  -- v_target_status = 'succeeded' — the single place orders.refunded_cents
  -- is ever incremented. Reachable exactly once per row: every other
  -- caller for this same row either lands in one of the two terminal
  -- branches above (no-op) or serializes behind this one's row lock and
  -- then finds status already 'succeeded'.
  update refund_requests
  set status = 'succeeded',
      stripe_refund_id = coalesce(p_stripe_refund_id, stripe_refund_id)
  where id = p_refund_request_id;

  -- A single atomic `refunded_cents = refunded_cents + ...` — not a
  -- separate select-then-update — because two *different* refund_requests
  -- rows for the same order (e.g. two partial refunds) can each be
  -- reaching this exact branch at the same time. Postgres's own row-level
  -- locking on the UPDATE itself (not an explicit `for update` beforehand)
  -- is what makes the increment atomic: the second UPDATE to run always
  -- sees the first one's already-committed value, so nothing gets lost the
  -- way a read-old-value-then-write-computed-value pair could.
  update orders
  set refunded_cents = refunded_cents + v_req.amount_cents
  where id = v_req.order_id
  returning refunded_cents into v_new_refunded_cents;

  update orders
  set status = case when v_new_refunded_cents >= total_cents then 'refunded' else status end
  where id = v_req.order_id;

  return 'applied_succeeded';
end;
$$;

-- Same reasoning as 0018_lock_down_rpc_execute_grants.sql: these are only
-- ever meant to be called from a Netlify Function's service_role client.
-- `alter default privileges ... revoke execute on functions from public`
-- (also from 0018) already applies to every function created after it, so
-- these two are covered automatically — this is just making that explicit
-- and self-documenting rather than relying on an inherited default someone
-- reading this file in isolation wouldn't see.
revoke execute on function public.bind_refund_stripe_id(uuid, text, uuid, integer) from public;
revoke execute on function public.apply_refund_status(uuid, text, text, text, uuid, integer) from public;

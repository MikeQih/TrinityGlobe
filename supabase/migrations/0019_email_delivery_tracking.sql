-- -----------------------------------------------------------------------
-- Email delivery tracking ledger. Same motivation as refund_requests
-- (0014_refund_request_ledger.sql): "the API call to Resend succeeded" only
-- means Resend accepted the email for delivery, not that it ever reached
-- the customer's inbox — bounces, spam-suppression, and delivery delays all
-- happen *after* that response comes back, and until now none of it was
-- recorded anywhere. A guest order has no My Orders page to notice a
-- missing confirmation on their own, so staff need a way to see it.
--
-- Two independent things per order are tracked separately (customer
-- confirmation vs. staff notification), since one can fail while the other
-- succeeds — the staff address list and the customer's address are
-- unrelated deliveries.
-- -----------------------------------------------------------------------

create table email_logs (
  -- Doubles as the Resend Idempotency-Key for the *send attempt* this row
  -- represents — see claim_email_send below. Never regenerated for a retry
  -- of the same attempt, only a genuinely new attempt (e.g. a staff-
  -- initiated resend) gets a new row/key.
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id),
  email_type        text not null check (email_type in ('customer_confirmation', 'staff_notification')),
  recipient         text not null,
  -- pending: attempt claimed, Resend call not yet confirmed one way or
  --   the other (in flight, or a network error/ambiguous response — safe
  --   to retry with this same row's id as the idempotency key).
  -- accepted: Resend's API call returned success. Says nothing about
  --   whether the message ever reaches an inbox — see the module comment.
  -- delivered / delayed / failed / bounced / suppressed: from Resend's
  --   webhook events (email.delivered / email.delivery_delayed /
  --   email.failed / email.bounced / email.suppressed) — see
  --   resend-webhook.ts and apply_email_webhook_event below.
  status            text not null default 'pending'
                      check (status in ('pending', 'accepted', 'delivered', 'delayed', 'failed', 'bounced', 'suppressed')),
  -- Resend's own message id (the `id` from a successful send response, or
  -- `data.email_id` from a webhook event) — the join key for webhook
  -- events, since Resend has no idea about our own row id.
  resend_email_id   text,
  failure_reason    text,
  -- Who triggered this specific attempt: null for the automatic send at
  -- checkout/payment time, an admin_profiles user_id for a staff-initiated
  -- resend from admin-app.
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_email_logs_order_id on email_logs(order_id);
-- Resend email ids are globally unique per send, but only assigned once
-- the send succeeds — many rows can sit at resend_email_id is null
-- (still pending, or a definitively failed attempt that never got one).
create unique index idx_email_logs_resend_email_id on email_logs(resend_email_id) where resend_email_id is not null;

alter table email_logs enable row level security;

-- Same shape as refund_requests: staff can see the ledger, but nobody
-- (not even admin/ops) gets a write policy — every write here goes
-- through claim_email_send/settle_email_send/apply_email_webhook_event,
-- called only from Netlify Functions using the service_role key.
create policy "staff can view email logs"
  on email_logs for select
  using (current_admin_role() in ('admin', 'ops', 'finance_readonly'));

create trigger trg_email_logs_updated_at
  before update on email_logs
  for each row execute function set_updated_at();

-- Claims (or resumes) a send attempt, atomically — mirrors
-- claim_refund_request's reasoning exactly: call this *before* ever
-- talking to Resend, and the caller is expected to retry Resend with
-- *this* row's id as the Idempotency-Key, not mint a new one.
--
-- p_force_new is for a staff-initiated resend from admin-app: that's
-- always a deliberate new attempt (the previous one may already be
-- 'delivered'), never a retry of whatever's currently pending, so it
-- skips the resume-if-pending check entirely.
create function claim_email_send(
  p_order_id uuid,
  p_email_type text,
  p_recipient text,
  p_created_by uuid default null,
  p_force_new boolean default false
) returns email_logs
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_existing public.email_logs;
  v_new public.email_logs;
begin
  if p_email_type not in ('customer_confirmation', 'staff_notification') then
    raise exception 'invalid_email_type: %', p_email_type using errcode = 'P0001';
  end if;

  -- Serializes concurrent claims for the same order+type (e.g. a webhook
  -- redelivery landing at the same moment as a staff resend click) without
  -- taking a lock on the busy orders table itself.
  perform pg_advisory_xact_lock(hashtext('email_send:' || p_order_id::text || ':' || p_email_type));

  if not p_force_new then
    select * into v_existing
    from public.email_logs
    where order_id = p_order_id and email_type = p_email_type and status = 'pending'
    order by created_at desc
    limit 1
    for update;

    if found then
      return v_existing;
    end if;
  end if;

  insert into public.email_logs (order_id, email_type, recipient, created_by)
  values (p_order_id, p_email_type, p_recipient, p_created_by)
  returning * into v_new;

  return v_new;
end;
$$;

-- Records the outcome of actually calling Resend for a claimed attempt.
-- p_outcome is only ever 'accepted' (Resend's API call succeeded — the
-- webhook will carry the story from here) or 'failed' (a *definitive*
-- rejection, e.g. a malformed from-address — see the PERMANENT_FAILURE
-- classification in _lib/email.ts). Anything ambiguous (network error,
-- rate limit, an error code that might resolve on retry) should *not*
-- call this at all — leaving the row at 'pending' is what makes retrying
-- with the same id/idempotency-key safe and correct.
create function settle_email_send(
  p_email_log_id uuid,
  p_outcome text,
  p_resend_email_id text default null,
  p_failure_reason text default null
) returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if p_outcome not in ('accepted', 'failed') then
    raise exception 'invalid_outcome: %', p_outcome using errcode = 'P0001';
  end if;

  update public.email_logs
  set status = p_outcome, resend_email_id = p_resend_email_id, failure_reason = p_failure_reason
  where id = p_email_log_id and status = 'pending';
end;
$$;

-- Applies a Resend webhook delivery event to the matching row (joined by
-- Resend's own email id, not ours). Guards against events arriving out of
-- order — Resend doesn't guarantee delivery order any more than Stripe
-- does — by only ever moving a row's status *forward* along
-- pending(0) < accepted(1) < delayed(2) < delivered(3) < failed(4) <
-- bounced(5) < suppressed(6). A late "delayed" arriving after "delivered"
-- is a strictly less useful thing to know than what's already recorded,
-- so it's discarded rather than regressing the status shown to staff.
create function apply_email_webhook_event(
  p_resend_email_id text,
  p_status text,
  p_failure_reason text default null
) returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_rank constant jsonb := '{"pending":0,"accepted":1,"delayed":2,"delivered":3,"failed":4,"bounced":5,"suppressed":6}'::jsonb;
  v_row public.email_logs;
begin
  if p_status not in ('pending', 'accepted', 'delivered', 'delayed', 'failed', 'bounced', 'suppressed') then
    raise exception 'invalid_status: %', p_status using errcode = 'P0001';
  end if;

  select * into v_row from public.email_logs where resend_email_id = p_resend_email_id for update;
  if not found then
    -- A webhook event for an email_id we don't have a row for — e.g. one
    -- sent before this migration, or a test message. Nothing to update.
    return;
  end if;

  if (v_rank ->> p_status)::int < (v_rank ->> v_row.status)::int then
    return;
  end if;

  update public.email_logs
  set status = p_status, failure_reason = coalesce(p_failure_reason, failure_reason)
  where id = v_row.id;
end;
$$;

-- Webhook event dedup ledger — mirrors stripe_events exactly (Resend's
-- webhook delivery has the same at-least-once semantics as Stripe's).
-- No RLS policies at all: like checkout_rate_limits and stripe_events,
-- this is a pure internal record nobody (not even staff) needs to read
-- directly, so it's only ever reachable via service_role.
create table resend_webhook_events (
  webhook_event_id  text primary key,
  event_type        text not null,
  received_at       timestamptz not null default now()
);

alter table resend_webhook_events enable row level security;

-- CORRECTION: 0018_lock_down_rpc_execute_grants.sql's closing statement
-- (`alter default privileges in schema public revoke execute on functions
-- from public`) was meant to make exactly this unnecessary going forward —
-- it does not. Checked live against pg_proc.proacl immediately after the
-- three functions above were created by this same migration: all three
-- still carried the `=X/postgres` PUBLIC grant, identical to every
-- function from before 0018 ever existed. Supabase's own project
-- bootstrap apparently sets its "grant execute to PUBLIC on every new
-- function" default privilege under a role/scope that a plain `alter
-- default privileges in schema public ... from public` run as the SQL
-- Editor's `postgres` role doesn't reach or override — so nothing about
-- that statement should be trusted to actually change future migrations'
-- behavior, despite being syntactically valid and errorless. The three
-- REVOKEs below undo it for these specific functions, applied and
-- reconfirmed empty of any `=X` entry live. Every future migration that
-- adds a function meant to be service_role-only must do the same
-- explicit `revoke execute on function ... from public;` itself — do not
-- rely on a schema-wide default privileges change again.
revoke execute on function public.claim_email_send(uuid, text, text, uuid, boolean) from public;
revoke execute on function public.settle_email_send(uuid, text, text, text) from public;
revoke execute on function public.apply_email_webhook_event(text, text, text) from public;

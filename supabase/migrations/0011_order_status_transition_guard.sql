-- -----------------------------------------------------------------------
-- Enforces valid order status transitions at the database level. Until
-- now, nothing stopped a plain `update orders set status = ...` (which is
-- exactly what admin-app's status-change buttons and refund handler do)
-- from setting *any* status from *any* other status — e.g. clicking
-- "preparing" on an already-completed order, or "paid" on a cancelled
-- one. RLS (0001_init.sql) only checks *who* can write to orders, not
-- *what* transition they're making.
--
-- This is a trigger, not just tighter admin-app UI logic, because a
-- trigger applies to every writer regardless of role or RLS-bypass —
-- admin-app's client-side updates, the webhook's service-role client, and
-- every RPC in 0008_checkout_hardening.sql all go through the same
-- `update orders set status = ...` statement form under the hood.
--
-- The allowed graph, in business terms:
--   pending_payment -> paid | payment_failed | expired | cancelled
--   paid / preparing / ready_for_collection / out_for_delivery / completed
--     -> (their normal next fulfilment step) | refunded
--     (cancelled is deliberately NOT reachable once paid — once money has
--     changed hands, "the customer doesn't get this order" is a refund,
--     not a cancellation; cancelled means no payment was ever collected)
--   any status -> payment_review
--     (mark_order_paid_from_webhook's dead-end case: a late/duplicate
--     "payment succeeded" webhook can land on an order in literally any
--     state, and must always be able to flag it for review rather than
--     erroring out — Stripe would otherwise retry the webhook forever)
--   cancelled / refunded / payment_review -> nothing (terminal)
--     (payment_review has no resolution path yet — deliberately left as a
--     dead end for now rather than guessing at one; see PROJECT_STATUS.md)
-- -----------------------------------------------------------------------

create function validate_order_status_transition() returns trigger
language plpgsql as $$
declare
  v_allowed boolean;
begin
  if new.status = old.status then
    return new; -- not a status change (or a write to some other column)
  end if;

  v_allowed := case old.status
    when 'pending_payment' then new.status in ('paid', 'payment_failed', 'expired', 'cancelled', 'payment_review')
    when 'paid' then new.status in ('preparing', 'refunded', 'payment_review')
    when 'preparing' then new.status in ('ready_for_collection', 'out_for_delivery', 'refunded', 'payment_review')
    when 'ready_for_collection' then new.status in ('completed', 'refunded', 'payment_review')
    when 'out_for_delivery' then new.status in ('completed', 'refunded', 'payment_review')
    when 'completed' then new.status in ('refunded', 'payment_review')
    when 'cancelled' then new.status in ('payment_review')
    when 'expired' then new.status in ('payment_review')
    when 'payment_failed' then new.status in ('payment_review')
    when 'refunded' then new.status in ('payment_review')
    when 'payment_review' then false
    else false
  end;

  if not v_allowed then
    raise exception 'invalid_order_status_transition: % -> %', old.status, new.status using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_validate_order_status_transition
  before update of status on orders
  for each row
  execute function validate_order_status_transition();

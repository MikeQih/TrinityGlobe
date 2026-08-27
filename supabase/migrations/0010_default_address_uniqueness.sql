-- -----------------------------------------------------------------------
-- Guarantees "at most one default address per customer" at the database
-- level instead of only in application code. The previous implementation
-- (src/addresses-page.ts) did a plain client-side "clear every other
-- row's is_default, then set/insert this one as default" as two separate
-- Supabase calls — not atomic, so two concurrent requests (two open tabs,
-- a slow network retry) could both pass the "clear" step before either
-- ran its "set" step, leaving two rows marked default at once.
-- -----------------------------------------------------------------------

-- Safety pass before the index is added: collapse any user who already
-- has more than one default (shouldn't happen given the app's own
-- discipline so far, but the index creation below would fail outright if
-- it ever did) down to their most recently created default.
with ranked as (
  select id, row_number() over (partition by user_id order by created_at desc) as rn
  from customer_addresses
  where is_default
)
update customer_addresses
set is_default = false
where id in (select id from ranked where rn > 1);

create unique index one_default_address_per_customer
  on customer_addresses (user_id)
  where is_default;

-- Atomically clears every other default for this customer and sets the
-- given address as the new one. Ownership is re-checked here (not just
-- trusted from the caller) for the same reason every other customer-facing
-- RPC in this project does — see cancel_own_pending_order.
create function set_default_customer_address(
  p_user_id uuid,
  p_address_id uuid
) returns void
language plpgsql as $$
declare
  v_owner uuid;
begin
  select user_id into v_owner from customer_addresses where id = p_address_id for update;
  if not found then
    raise exception 'address_not_found';
  end if;
  if v_owner is distinct from p_user_id then
    raise exception 'not_address_owner';
  end if;

  update customer_addresses set is_default = false where user_id = p_user_id and is_default;
  update customer_addresses set is_default = true where id = p_address_id;
end;
$$;

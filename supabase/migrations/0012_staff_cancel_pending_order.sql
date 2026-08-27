-- -----------------------------------------------------------------------
-- Staff-initiated counterpart to cancel_own_pending_order (see
-- 0008_checkout_hardening.sql). That RPC requires p_user_id to match the
-- order's owner — correct for a customer cancelling their own order from
-- My Orders, but wrong for a staff member cancelling on a customer's
-- behalf from admin-app (the order may be a guest order with no user_id
-- at all, or belong to a different customer than whoever is signed into
-- admin-app). Authorization for *this* RPC is enforced by the caller
-- (admin-cancel-order.ts checks admin_profiles.role before ever calling
-- it), the same pattern admin-refund-order.ts already uses for refunds.
-- -----------------------------------------------------------------------
create function cancel_pending_order_as_staff(
  p_order_id uuid
) returns text
language plpgsql as $$
declare
  v_status text;
  v_res_id uuid;
begin
  select status into v_status from orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;

  if v_status <> 'pending_payment' then
    return v_status;
  end if;

  for v_res_id in
    select id from inventory_reservations where order_id = p_order_id and status in ('pending', 'confirmed')
  loop
    perform release_inventory_reservation(v_res_id);
  end loop;

  update orders set status = 'cancelled' where id = p_order_id;
  return 'cancelled';
end;
$$;

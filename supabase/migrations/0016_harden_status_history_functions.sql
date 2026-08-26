-- -----------------------------------------------------------------------
-- 0013 made log_order_status_initial/log_order_status_change SECURITY
-- DEFINER with search_path pinned to `public, pg_temp` — necessary so
-- their insert into order_status_history isn't blocked by RLS when the
-- triggering UPDATE came from a non-service-role caller (admin-app's own
-- staff JWT), but not sufficient on its own: Postgres always consults a
-- session's temporary schema first when resolving an unqualified table
-- name, regardless of where (or whether) pg_temp appears in search_path.
-- A low-privileged session could in principle create a temp table named
-- `order_status_history` and have this SECURITY DEFINER function silently
-- write into that instead of the real table — the classic search_path
-- privilege-escalation pattern (CVE-2018-1058) for SECURITY DEFINER
-- functions. search_path pinning alone doesn't close it; only fully
-- schema-qualifying every reference does, since that removes the lookup
-- Postgres would otherwise do entirely.
--
-- Both functions are otherwise minimal by construction: no dynamic SQL,
-- no caller-supplied parameters (they're trigger functions — their only
-- inputs are OLD/NEW row data from a table update already gated by
-- orders' own RLS/role checks), and exactly one hardcoded INSERT each.
-- Qualifying the table name is the only change needed to make them fully
-- safe to run as SECURITY DEFINER.
-- -----------------------------------------------------------------------
create or replace function log_order_status_initial() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.order_status_history (order_id, from_status, to_status)
  values (new.id, null, new.status);
  return new;
end;
$$;

create or replace function log_order_status_change() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    insert into public.order_status_history (order_id, from_status, to_status)
    values (new.id, old.status, new.status);
  end if;
  return new;
end;
$$;

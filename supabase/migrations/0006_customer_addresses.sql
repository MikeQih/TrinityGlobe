-- -----------------------------------------------------------------------
-- customer_addresses: a signed-in customer's saved address book (the "My
-- Address" nav item). Multiple rows per customer, unlike customer_profiles
-- (one row per user) — hence a generated id instead of user_id as the
-- primary key, with an index on user_id for the "list my addresses" query.
--
-- Written directly from the client via supabase-js (same pattern as
-- auth.ts#saveCustomerProfile) — RLS below is what actually keeps a
-- customer from reading or writing anyone else's address, not app code.
-- -----------------------------------------------------------------------
create table customer_addresses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  label           text,
  recipient_name  text not null,
  phone           text not null,
  address         text not null,
  postal_code     text not null,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now()
);

create index idx_customer_addresses_user_id on customer_addresses(user_id);

alter table customer_addresses enable row level security;

create policy "customers manage own addresses"
  on customer_addresses for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

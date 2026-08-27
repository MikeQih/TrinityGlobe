-- -----------------------------------------------------------------------
-- customer_profiles: extra signup fields (paneco-style: name, gender, DOB,
-- newsletter opt-in) for customers who create an account, keyed to
-- Supabase Auth's auth.users. Google/Facebook sign-ins never populate this
-- table — it's only written by the email/password signup form, which is
-- the one flow that actually collects these fields.
--
-- date_of_birth doubles as a real age check for an alcohol business, not
-- just a paneco-style "send birthday perks" field — the check constraint
-- below enforces 18+ at the database level too, as a second layer behind
-- the client-side validation in the signup form.
-- -----------------------------------------------------------------------
create table customer_profiles (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  first_name             text not null,
  last_name              text not null,
  gender                 text not null check (gender in ('male', 'female', 'prefer_not_to_say')),
  date_of_birth          date not null check (date_of_birth <= (current_date - interval '18 years')),
  newsletter_subscribed  boolean not null default false,
  created_at             timestamptz not null default now()
);

alter table customer_profiles enable row level security;

-- A customer can create/view/update only their own profile row — never
-- anyone else's, and staff access goes through admin_profiles/service role
-- instead, not through this policy.
create policy "customers manage own profile"
  on customer_profiles for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

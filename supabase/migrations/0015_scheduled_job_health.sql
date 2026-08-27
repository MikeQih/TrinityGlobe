-- -----------------------------------------------------------------------
-- Tracks whether release-expired-reservations.ts (the scheduled function
-- that flips lapsed reservations to 'expired' and force-closes their
-- Stripe sessions — see 0001_init.sql's expire_stale_reservations and
-- that Function's own doc comment) is actually running. Discovered during
-- the admin-app regression that several reservations were sitting well
-- past their expires_at with status still 'pending' — Netlify Scheduled
-- Functions only run on a real Published Deploy, never on a Deploy
-- Preview/branch deploy, so this can silently never fire in an
-- environment that never got the production deploy it needs. Without
-- this, that failure mode is invisible until a customer notices stock is
-- "sold out" that shouldn't be.
-- -----------------------------------------------------------------------
create table scheduled_job_runs (
  job_name         text primary key,
  last_run_at      timestamptz,
  last_success_at  timestamptz,
  last_error       text
);

insert into scheduled_job_runs (job_name) values ('release_expired_reservations');

alter table scheduled_job_runs enable row level security;

create policy "staff can view scheduled job health"
  on scheduled_job_runs for select
  using (current_admin_role() in ('admin', 'ops', 'finance_readonly'));

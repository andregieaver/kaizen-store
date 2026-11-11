-- Code review step 1.5 (finding FD9): every query the app sends is bounded. The app, CI's migrations and Supabase's tools reach the
-- database as the `postgres` role (through Supavisor, whose transaction mode drops a connection's own start-up settings), so the limits
-- are the role's: a statement may run 15 seconds and wait 5 seconds for a lock, after which Postgres cancels it and the connection goes
-- back to the pool. Supabase already gives the role `idle_in_transaction_session_timeout = 30s` and `transaction_timeout = 60s`.
-- A job that needs longer raises its own limit for one transaction (`longerTimeout()` in src/db/client.ts: `set local`); the migration
-- runner sets its own in each file's transaction (scripts/db-migrate.mjs). Only on Supabase (its `supabase_admin` role is there): a
-- developer's or CI's database keeps no limit, so a slow test machine is not cut short.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    ALTER ROLE postgres SET statement_timeout = '15s';
    ALTER ROLE postgres SET lock_timeout = '5s';
  END IF;
END
$$;

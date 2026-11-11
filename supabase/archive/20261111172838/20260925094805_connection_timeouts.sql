-- A transaction the app left unfinished must not hold one of the pooler's few
-- connections to Postgres (decision D37). The app's transactions take
-- milliseconds; one open for a minute was abandoned (its function frozen or
-- gone mid-query), so Postgres ends its session and the pooler opens a fresh one.
-- transaction_timeout exists from Postgres 17 (production); older local and
-- test servers keep the idle-in-transaction limit only.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE $sql$ALTER ROLE postgres SET transaction_timeout = '60s'$sql$;
  END IF;
END
$$;
--> statement-breakpoint
ALTER ROLE postgres SET idle_in_transaction_session_timeout = '30s';

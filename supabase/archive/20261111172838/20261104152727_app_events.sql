-- Apps for many stores, D2 (wave 14 unit D, D441): an installation's own events, and what ending it sends.
--
-- * An installation (an `admin` grant) that ends, however it ends (an owner's Remove, the person who installed it leaving the store or
--   having their account erased, a platform admin blocking the app, the person's password or second step changed), switches its endpoint
--   off (`disabled_reason = 'uninstalled'`) and queues `app.uninstalled` at once and `store.erase_requested` 48 hours later to it; the
--   sender sends those two though the endpoint is off, and nothing else. A deferred trigger, so that installing an app again, which ends
--   the old installation and moves its endpoint to the new one in the same transaction, sends neither.
-- * The person who installed an app leaving the store (their membership deleted, by an owner or by erasing their account) ends their
--   installations on it, with their tokens and what they still wait on a yes for.
CREATE FUNCTION commerce.app_installation_ended() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE commerce.webhook_endpoints SET enabled = false, disabled_reason = 'uninstalled', updated_at = now()
  WHERE app_grant_id = NEW.id;
  INSERT INTO commerce.integration_deliveries (store_id, provider, event, subject_id, endpoint_id, next_attempt_at)
  SELECT e.store_id, 'webhook', x.event, NEW.id, e.id, now() + x.after
  FROM commerce.webhook_endpoints e
  CROSS JOIN (VALUES ('app.uninstalled', interval '0 hours'), ('store.erase_requested', interval '48 hours')) AS x(event, after)
  WHERE e.app_grant_id = NEW.id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER oauth_grants_installation_ended
AFTER UPDATE OF revoked_at ON commerce.oauth_grants
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL AND NEW.resource = 'admin')
EXECUTE FUNCTION commerce.app_installation_ended();
--> statement-breakpoint
CREATE FUNCTION commerce.store_member_left_apps() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- A store being deleted takes its installations with it: nothing to end.
  IF NOT EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = OLD.store_id) THEN
    RETURN NULL;
  END IF;
  UPDATE commerce.oauth_tokens SET revoked_at = coalesce(revoked_at, now())
  WHERE grant_id IN (
    SELECT g.id FROM commerce.oauth_grants g
    WHERE g.account_id = OLD.account_id AND g.store_id = OLD.store_id AND g.resource = 'admin' AND g.revoked_at IS NULL
  );
  UPDATE commerce.assistant_approvals
     SET status = 'expired', decided_at = now(),
         result = jsonb_build_object('error', 'The connection that asked for it was ended, so it can no longer be approved.')
   WHERE status = 'pending' AND oauth_grant_id IN (
     SELECT g.id FROM commerce.oauth_grants g
     WHERE g.account_id = OLD.account_id AND g.store_id = OLD.store_id AND g.resource = 'admin' AND g.revoked_at IS NULL
   );
  UPDATE commerce.oauth_grants SET revoked_at = now()
  WHERE account_id = OLD.account_id AND store_id = OLD.store_id AND resource = 'admin' AND revoked_at IS NULL;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER store_members_left_apps
AFTER DELETE ON commerce.store_members
FOR EACH ROW
EXECUTE FUNCTION commerce.store_member_left_apps();

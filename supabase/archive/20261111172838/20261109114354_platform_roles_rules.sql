-- Roles on the platform's team (D510). An owner (`platform_admin`) is an owner of Kaizena Flow's own store, as before (D466); a member
-- with a role (`platform_role`: support, content, finance, read-only) may be an admin of it, in the store role of the same work, which
-- the team page sets (`src/server/platform-team.ts`); no one else works in it.

CREATE OR REPLACE FUNCTION commerce.store_members_house()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.disabled_at IS NULL
     AND EXISTS (SELECT 1 FROM commerce.stores s WHERE s.id = NEW.store_id AND s.house)
     AND NOT EXISTS (
       SELECT 1 FROM commerce.accounts a
        WHERE a.id = NEW.account_id AND a.disabled_at IS NULL
          AND (a.platform_admin OR (a.platform_role IS NOT NULL AND NEW.role = 'admin'))
     ) THEN
    RAISE EXCEPTION 'store_members.house: only the platform''s team works in Kaizena Flow''s own store' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.house_members_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_store uuid := commerce.house_store();
BEGIN
  IF v_store IS NULL THEN
    RETURN NULL;
  END IF;
  IF NEW.platform_admin AND NEW.disabled_at IS NULL THEN
    INSERT INTO commerce.store_members (store_id, account_id, role)
    VALUES (v_store, NEW.id, 'owner')
    ON CONFLICT (store_id, account_id) DO UPDATE SET role = 'owner', disabled_at = NULL, expires_at = NULL, role_id = NULL, kind = 'staff'
      WHERE commerce.store_members.disabled_at IS NOT NULL OR commerce.store_members.role <> 'owner';
  ELSIF NEW.platform_role IS NOT NULL AND NEW.disabled_at IS NULL THEN
    -- A member: never the store's owner; the team page makes them an admin in their role's store role in the same transaction.
    UPDATE commerce.store_members SET disabled_at = now()
     WHERE store_id = v_store AND account_id = NEW.id AND disabled_at IS NULL AND role = 'owner';
  ELSIF TG_OP = 'UPDATE' THEN
    -- The last platform admin may stop being one: the store is then left without an owner until the next one (`keep_an_owner()`).
    UPDATE commerce.store_members SET disabled_at = now()
     WHERE store_id = v_store AND account_id = NEW.id AND disabled_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS accounts_house_members ON commerce.accounts;
--> statement-breakpoint

CREATE TRIGGER accounts_house_members AFTER INSERT OR UPDATE OF platform_admin, platform_role, disabled_at ON commerce.accounts
  FOR EACH ROW EXECUTE FUNCTION commerce.house_members_sync();

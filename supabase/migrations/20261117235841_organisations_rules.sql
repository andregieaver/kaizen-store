-- Paid extensions, step E1 (D748, docs/extensions.md 8.1): every store belongs to an organisation, the account that billing, plans and
-- extensions will see. The database places each store itself, whichever way it was made, so no writer of commerce.stores has to.

-- Kaizena Flow's own organisation: it holds the platform's stores and is never billed. Made once, on first need.
CREATE OR REPLACE FUNCTION commerce.platform_organisation() RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM commerce.organisations WHERE platform;
  IF v_id IS NULL THEN
    INSERT INTO commerce.organisations (name, platform) VALUES ('Kaizena Flow', true)
    ON CONFLICT (platform) WHERE platform DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM commerce.organisations WHERE platform;
    END IF;
  END IF;
  RETURN v_id;
END;
$$;
--> statement-breakpoint

-- The organisation an account owns, made on first need with the account as its owner and named after the store that brought them (never
-- after the person: the account's own erasure, D377, would leave a copy). One per account: two stores made at once for the same person wait
-- for each other here.
CREATE OR REPLACE FUNCTION commerce.account_organisation(p_account uuid, p_name text DEFAULT NULL) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('commerce.account_organisation'), hashtext(p_account::text));
  SELECT m.organisation_id INTO v_id
    FROM commerce.organisation_members m
    JOIN commerce.organisations o ON o.id = m.organisation_id
   WHERE m.account_id = p_account AND m.role = 'owner' AND NOT o.platform
   ORDER BY m.created_at, m.organisation_id
   LIMIT 1;
  IF v_id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM commerce.accounts WHERE id = p_account) THEN
      RAISE EXCEPTION 'organisations.no_account: there is no account %', p_account USING ERRCODE = 'foreign_key_violation';
    END IF;
    INSERT INTO commerce.organisations (name)
    VALUES (coalesce(nullif(trim(p_name), ''), 'My account'))
    RETURNING id INTO v_id;
    INSERT INTO commerce.organisation_members (organisation_id, account_id, role) VALUES (v_id, p_account, 'owner');
  END IF;
  RETURN v_id;
END;
$$;
--> statement-breakpoint

-- Where a store belongs: Kaizena Flow's own stores (the template, store templates and their frozen copies, sandboxes, the house store) in
-- the platform's organisation, every other in the organisation of the account that made it, else of its first owner. A store already
-- placed stays where it is unless p_move (its kind changed: a sandbox kept by its visitor, a store made Kaizena Flow's own). Returns the
-- organisation, or null for a store nobody owns yet: its first owner places it.
CREATE OR REPLACE FUNCTION commerce.place_store(p_store uuid, p_move boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_store commerce.stores;
  v_owner uuid;
  v_target uuid;
BEGIN
  SELECT * INTO v_store FROM commerce.stores WHERE id = p_store;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_store.organisation_id IS NOT NULL AND NOT p_move THEN
    RETURN v_store.organisation_id;
  END IF;
  IF v_store.is_template OR v_store.starter OR v_store.sandbox OR v_store.house THEN
    v_target := commerce.platform_organisation();
  ELSE
    SELECT m.account_id INTO v_owner
      FROM commerce.store_members m
     WHERE m.store_id = p_store AND m.role = 'owner'
     ORDER BY m.account_id IS DISTINCT FROM v_store.created_by, m.disabled_at IS NOT NULL, m.created_at, m.account_id
     LIMIT 1;
    IF v_owner IS NULL THEN
      RETURN v_store.organisation_id;
    END IF;
    v_target := commerce.account_organisation(v_owner, v_store.name);
  END IF;
  IF v_store.organisation_id IS DISTINCT FROM v_target THEN
    UPDATE commerce.stores SET organisation_id = v_target WHERE id = p_store;
  END IF;
  RETURN v_target;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION commerce.platform_organisation() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.account_organisation(p_account uuid, p_name text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.place_store(p_store uuid, p_move boolean) FROM PUBLIC;
--> statement-breakpoint

-- A store is placed when its transaction commits, by when it has its kind (a sandbox or a store template is flagged after it is copied)
-- and its owner; and placed again when its kind changes.
CREATE OR REPLACE FUNCTION commerce.stores_place() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM commerce.place_store(NEW.id, TG_OP = 'UPDATE');
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER stores_place AFTER INSERT ON commerce.stores DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION commerce.stores_place();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER stores_place_moved AFTER UPDATE OF is_template, starter, sandbox, house ON commerce.stores DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.is_template IS DISTINCT FROM NEW.is_template OR OLD.starter IS DISTINCT FROM NEW.starter
        OR OLD.sandbox IS DISTINCT FROM NEW.sandbox OR OLD.house IS DISTINCT FROM NEW.house)
  EXECUTE FUNCTION commerce.stores_place();
--> statement-breakpoint

-- A store that had nobody to own it is placed when its first owner arrives.
CREATE OR REPLACE FUNCTION commerce.store_members_place() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM commerce.place_store(NEW.store_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER store_members_place AFTER INSERT OR UPDATE OF role, account_id ON commerce.store_members DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.role = 'owner') EXECUTE FUNCTION commerce.store_members_place();
--> statement-breakpoint

-- RLS on, as on every commerce table: the Data API does not expose the schema, and server code reaches it through its own connection.
ALTER TABLE commerce.organisations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.organisation_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Every store there is today, oldest first: the platform's in Kaizena Flow's organisation, each other in its creator's.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM commerce.stores WHERE organisation_id IS NULL ORDER BY created_at, id LOOP
    PERFORM commerce.place_store(r.id);
  END LOOP;
END
$$;

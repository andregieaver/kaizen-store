-- Rules for staff and store settings.

-- The settings audit log can only grow.
CREATE TRIGGER settings_audit_log_append_only
  BEFORE UPDATE OR DELETE ON commerce.settings_audit_log
  FOR EACH ROW EXECUTE FUNCTION commerce.forbid_change();
--> statement-breakpoint

-- Once a store has an owner, it must always keep at least one active owner,
-- so nobody can lock everyone out of staff and payment settings.
CREATE FUNCTION commerce.keep_an_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NEW.disabled_at IS NOT NULL)
     AND OLD.role = 'owner' AND OLD.disabled_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM commerce.staff
        WHERE role = 'owner' AND disabled_at IS NULL AND id <> OLD.id
     ) THEN
    RAISE EXCEPTION 'the store must keep at least one active owner'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint

CREATE TRIGGER staff_keep_an_owner
  BEFORE UPDATE OR DELETE ON commerce.staff
  FOR EACH ROW EXECUTE FUNCTION commerce.keep_an_owner();
--> statement-breakpoint

ALTER TABLE commerce.staff ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.payment_providers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.payment_credentials ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.payment_methods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.settings_audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Stripe is the provider (decision D3); it starts disabled, in test mode.
INSERT INTO commerce.payment_providers (provider) VALUES ('stripe');

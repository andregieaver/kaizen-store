-- Paid extensions' launch (D748 step E5 part two, docs/extensions.md 13): from the launch every account is billed through its account.
-- The launch moves every account that has an open store and gives every other account an empty row; an account made after it (a sign-up,
-- an approved request, a first store by a new owner) gets its row here, as it is made, so no account is billed store by store again.
-- Kaizena Flow's own account is never billed (organisation_billing_platform), so it gets none. Before the launch this does nothing.
CREATE FUNCTION commerce.organisation_billed_after_launch() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT NEW.platform AND EXISTS (SELECT 1 FROM commerce.platform_settings ps WHERE ps.extensions_launched_at <= now()) THEN
    INSERT INTO commerce.organisation_billing (organisation_id) VALUES (NEW.id) ON CONFLICT (organisation_id) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.organisation_billed_after_launch() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER organisation_billed_after_launch AFTER INSERT ON commerce.organisations
  FOR EACH ROW EXECUTE FUNCTION commerce.organisation_billed_after_launch();

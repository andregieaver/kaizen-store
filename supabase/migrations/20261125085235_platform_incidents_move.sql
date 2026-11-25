-- The incident log's moves between statuses (D895): only the moves of INCIDENT_MOVES in src/lib/incidents.ts, so no writer can skip a
-- step (a proposal is never built without the owner's Approve: proposed may only become approved or dismissed). The kind checks on the
-- table refuse a move to a status the kind does not have. updated_at follows every change. A new move goes in src/lib/incidents.ts first.
CREATE FUNCTION commerce.platform_incidents_move() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
    AND NOT (OLD.status || '>' || NEW.status) = ANY (ARRAY['open>claimed', 'open>wont_fix', 'proposed>approved', 'proposed>dismissed', 'approved>claimed', 'approved>dismissed', 'approved>wont_fix', 'claimed>open', 'claimed>approved', 'claimed>fixed', 'claimed>needs_owner', 'fixed>done', 'fixed>open', 'fixed>approved', 'needs_owner>open', 'needs_owner>approved', 'needs_owner>wont_fix', 'done>open', 'dismissed>approved', 'wont_fix>open', 'wont_fix>approved']) THEN
    RAISE EXCEPTION 'platform_incidents_move: % to % is not allowed', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint THEN
    RAISE EXCEPTION 'platform_incidents_move: an entry keeps its kind and fingerprint' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER platform_incidents_move
BEFORE UPDATE ON commerce.platform_incidents
FOR EACH ROW EXECUTE FUNCTION commerce.platform_incidents_move();

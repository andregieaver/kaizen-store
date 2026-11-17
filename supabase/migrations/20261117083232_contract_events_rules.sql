-- Contracts' events (D695 step 4): a contract sent for signing, signed by everyone or declined by a signer is queued for the store's
-- services, endpoints and workflows that chose it, as a draft order's are (`integration_draft_events()`). A draft, an expiry and a
-- cancel are not events. The payload is built when it is sent (`contractData()`), never with a signer's email or reason.

CREATE OR REPLACE FUNCTION commerce.integration_contract_events() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.store_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  IF NEW.status = 'sent' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'contract.sent', NEW.id);
  ELSIF NEW.status = 'signed' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'contract.signed', NEW.id);
  ELSIF NEW.status = 'declined' THEN
    PERFORM commerce.queue_integration_event(NEW.store_id, 'contract.declined', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_integration_events ON commerce.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_integration_events AFTER UPDATE OF status ON commerce.contracts
  FOR EACH ROW EXECUTE FUNCTION commerce.integration_contract_events();

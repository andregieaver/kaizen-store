-- A domain per country (wave 7 unit D, D338, docs/wave-7-storefront.md D2): a store gives domains to its countries or to its languages
-- (D313), never both, so every market has one address. The writer (`setDomainCountry()`, `setDomainLanguage()`) says so first; this keeps it.

CREATE FUNCTION commerce.store_domains_one_kind() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.market IS NOT NULL AND EXISTS (
    SELECT 1 FROM commerce.store_domains d WHERE d.store_id = NEW.store_id AND d.id <> NEW.id AND d.language IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A store gives domains to its countries or to its languages, not both.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.language IS NOT NULL AND EXISTS (
    SELECT 1 FROM commerce.store_domains d WHERE d.store_id = NEW.store_id AND d.id <> NEW.id AND d.market IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A store gives domains to its countries or to its languages, not both.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE TRIGGER store_domains_one_kind
  BEFORE INSERT OR UPDATE OF language, market ON commerce.store_domains
  FOR EACH ROW EXECUTE FUNCTION commerce.store_domains_one_kind();

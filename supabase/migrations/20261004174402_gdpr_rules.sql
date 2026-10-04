-- GDPR export, erasure and retention (D162, docs/wave-1g-gdpr.md): the rules that live in the database.
--
-- * retention_rules: the platform's schedule, seeded with source, basis and date (all unverified), read through
--   commerce.retention_rule() and written only by commerce.set_retention_rule() (history kept, a bookkeeping period under
--   five years refused);
-- * privacy_requests: the one-month clock of Art. 12(3): an extension once, with a reason, before the due date, to at most
--   three months; a finished request never changes (its email is forgotten after 30 days) and is deleted only after 24 months;
-- * orders: commerce.anonymise_order() / anonymise_expired_orders() replace a person's fields with a marker (UPDATE only: no
--   DELETE, TRUNCATE or DROP in any function here, the production migration tool cancels them), restrict a sale that the
--   bookkeeping duty keeps (restricted_at, customer_id null) and refuse to anonymise a young one; the immutability triggers of
--   other units (VAT, copied orders, withdrawals, returns, VAT checks) give way only to the transaction-local setting
--   commerce.anonymising = 'on', which only these functions set (the 1b setting for the documents);
-- * copy_orders() leaves restricted and anonymised orders out.
-- Like every commerce table, row-level security on and no policies: the Data API reaches none of it.
ALTER TABLE commerce.retention_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.privacy_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Retention rules
-- ---------------------------------------------------------------------------

INSERT INTO commerce.retention_rules (kind, country, period_value, period_unit, counts_from, source, source_url, basis, checked_on, valid_from, enforced_by, note)
VALUES
    ('bookkeeping', 'NO', 60, 'months', 'end_of_year', 'Bokføringsloven § 13(2): accounting material is kept 5 years after the end of the financial year (page read 2026-10-04)', 'https://lovdata.no/lov/2004-11-19-73/§13', 'read', '2026-10-04', '2000-01-01', 'runRetention: commerce.anonymise_expired_orders()', 'Read at the act''s page. The financial year is taken as the calendar year (not modelled otherwise).'),
    ('bookkeeping', 'SE', 84, 'months', 'end_of_year', 'Bokföringslag (1999:1078) 7 kap. 2 §: kept to the end of the seventh year after the calendar year in which the financial year ended (text of the section read 2026-10-04)', 'https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/bokforingslag-19991078_sfs-1999-1078/', 'read', '2026-10-04', '2000-01-01', 'runRetention: commerce.anonymise_expired_orders()', 'Text of 7 kap. 2 § read. The financial year is taken as the calendar year.'),
    ('bookkeeping', 'DK', 60, 'months', 'end_of_year', 'Accounting material is kept 5 years after the end of the financial year (Skattestyrelsen''s guidance; a search result cites bogføringsloven § 10 for the period); snippet level, section number unconfirmed', 'https://tax.dk/jv-2022-1/ab/A_B_3_1_3.htm', 'snippet', '2026-10-04', '2000-01-01', 'runRetention: commerce.anonymise_expired_orders()', 'Not read at the act. Needs an accountant.'),
    ('bookkeeping', 'DE', 96, 'months', 'end_of_year', 'Booking records (invoices, receipts, order confirmations, delivery notes) 8 years from 1 January 2025 (BEG IV; § 147(3) AO, § 257(4) HGB), down from 10; search results only, gesetze-im-internet.de could not be read', NULL, 'secondary', '2026-10-04', '2000-01-01', 'runRetention: commerce.anonymise_expired_orders()', 'Secondary source. Needs an accountant.'),
    ('bookkeeping', NULL, 120, 'months', 'end_of_year', 'No rule has been read for this country: the longest period of the four that were, plus a margin, so nothing is anonymised sooner than a rule says', NULL, 'fallback', '2026-10-04', '2000-01-01', 'runRetention: commerce.anonymise_expired_orders()', 'Applies to every country with no row of its own.'),
    ('host_bookkeeping', NULL, 120, 'months', 'end_of_year', 'DAC7 (Directive (EU) 2021/514): platform operators keep records for at least 5 and at most 10 years, member states may extend; a search summary, not read', NULL, 'secondary', '2026-10-04', '2000-01-01', 'runRetention: commerce.anonymise_expired_orders()', 'A host''s order is reported by the store (D71); the longest period is the safe side.'),
    ('unpaid_orders', NULL, 30, 'days', 'event', 'An order never paid is not a sale and no law keeps it; the row stays (its number is gap-free), the person goes. Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'runRetention: commerce.anonymise_order()', 'From the day the order was placed.'),
    ('email_bodies', NULL, 12, 'months', 'event', 'Sent emails hold names, addresses and order contents. Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'runRetention: email_messages', 'The row stays (its idempotency key stops a replayed webhook from sending again); evidence kinds wait for their order.'),
    ('security_emails', NULL, 7, 'days', 'event', 'Sign-in codes, links, password resets and invitations are of no use after a short time. Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'runRetention: email_messages', ''),
    ('carts', NULL, 90, 'days', 'event', 'Carts hold a company name and VAT number. Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'runRetention: carts', 'After the cart ended (an open cart: its expiry).'),
    ('delivery_quotes', NULL, 30, 'days', 'event', 'A quote holds a postal code. Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'runRetention: delivery_quotes', 'After the quote expired.'),
    ('customer_codes', NULL, 7, 'days', 'event', 'Every email address that ever asked for a sign-in code would otherwise be kept for ever. Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'runRetention: customer_codes', 'After the code expired.'),
    ('customer_sessions', NULL, 30, 'days', 'event', 'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'runRetention: customer_sessions', 'After the session expired.'),
    ('webhook_payloads', NULL, 90, 'days', 'event', 'A payment provider''s event holds a name, an email and an address. Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'runRetention: webhook_events', 'After the event was processed; the row stays so its id still de-duplicates.'),
    ('consents', NULL, 12, 'months', 'event', 'The cookie consent log. Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'pg_cron kaizen-consent-retention and runRetention', 'Idempotent: the app step and the database job may both run.'),
    ('privacy_request_contact', NULL, 30, 'days', 'event', 'The address a finished privacy request was logged under is no longer needed. Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'runRetention: privacy_requests', 'After the request was done.'),
    ('privacy_requests', NULL, 24, 'months', 'event', 'The record that a request was answered in time. Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'runRetention: privacy_requests', 'After the request was done; the one deletion the table''s guard allows.'),
    ('search_queries', NULL, 90, 'days', 'event', 'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'pruneSearchLog() (SEARCH_LOG_DAYS)', 'The code''s constant is the source; a test holds them equal.'),
    ('visits', NULL, 25, 'months', 'event', 'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'pruneVisits() (RETENTION_MONTHS)', 'The code''s constant is the source; a test holds them equal.'),
    ('audit_log', NULL, 24, 'months', 'event', 'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'pruneAuditLog() (AUDIT_RETENTION_MONTHS)', 'The database refuses to remove a younger entry.'),
    ('form_submissions', NULL, 30, 'days', 'event', 'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'pruneFormSubmissions()', 'The code''s constant is the source; a test holds them equal.'),
    ('integration_deliveries', NULL, 30, 'days', 'event', 'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'integrations'' KEEP_DAYS', 'The code''s constant is the source; a test holds them equal.'),
    ('abandoned_checkouts', NULL, 30, 'days', 'event', 'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'cart reminders'' erase', 'The code''s constant is the source; a test holds them equal.'),
    ('recommendation_events', NULL, 90, 'days', 'event', 'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'recommendations'' EVENT_DAYS', 'The code''s constant is the source; a test holds them equal.'),
    ('ai_usage', NULL, 400, 'days', 'event', 'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-10-04', '2000-01-01', 'ai-usage''s USAGE_KEEP_DAYS', 'The code''s constant is the source; a test holds them equal.');
--> statement-breakpoint

-- A rule is never edited in place: the one end date (when a new rule replaces it) and the one review (who and when) are the only changes.
CREATE FUNCTION commerce.retention_rules_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'retention_rule_kept: a retention rule is history and is never deleted (add a new one)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'valid_to' - 'verified_at' - 'verified_by') IS DISTINCT FROM (to_jsonb(OLD) - 'valid_to' - 'verified_at' - 'verified_by') THEN
    RAISE EXCEPTION 'retention_rule_fixed: a retention rule is not edited in place (add a new one)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.valid_to IS NOT NULL AND NEW.valid_to IS DISTINCT FROM OLD.valid_to THEN
    RAISE EXCEPTION 'retention_rule_fixed: the end of a rule is set once' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.verified_at IS NOT NULL AND (NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.verified_by IS DISTINCT FROM OLD.verified_by) THEN
    RAISE EXCEPTION 'retention_rule_fixed: a review is kept as it was made' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER retention_rules_guard BEFORE UPDATE OR DELETE ON commerce.retention_rules
  FOR EACH ROW EXECUTE FUNCTION commerce.retention_rules_guard();
--> statement-breakpoint

-- The period that applies to a kind in a country on a day: the country's own row in force, else the default (no country), else the safe
-- side (ten years): an empty table never means "keep nothing" or "delete everything".
CREATE FUNCTION commerce.retention_rule(p_kind text, p_country char(2), p_at date)
RETURNS TABLE (period_value integer, period_unit text, counts_from text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH hit AS (
    SELECT r.period_value, r.period_unit, r.counts_from
      FROM commerce.retention_rules r
     WHERE r.kind = p_kind
       AND (r.country IS NULL OR r.country = p_country)
       AND r.valid_from <= p_at AND (r.valid_to IS NULL OR p_at < r.valid_to)
     ORDER BY (r.country IS NOT NULL) DESC, r.valid_from DESC
     LIMIT 1
  )
  SELECT h.period_value, h.period_unit, h.counts_from FROM hit h
  UNION ALL
  SELECT 120, 'months', CASE WHEN p_kind IN ('bookkeeping', 'host_bookkeeping') THEN 'end_of_year' ELSE 'event' END
   WHERE NOT EXISTS (SELECT 1 FROM hit)
$$;
--> statement-breakpoint

-- Changes a period: closes the one in force and adds the new one (history kept), refuses a bookkeeping period under five years (the
-- shortest of the four countries read) and anything above fifty years, and audit-logs. Returns the new row's id.
CREATE FUNCTION commerce.set_retention_rule(
  p_kind text, p_country char(2), p_value integer, p_unit text, p_counts_from text, p_source text, p_source_url text,
  p_basis text, p_checked_on date, p_valid_from date, p_enforced_by text, p_note text, p_account uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_latest date;
  v_previous record;
  v_months integer;
  v_id uuid;
BEGIN
  IF p_country IS NOT NULL AND NOT EXISTS (SELECT 1 FROM commerce.countries c WHERE c.code = p_country) THEN
    RAISE EXCEPTION 'retention_rule_country: unknown country %', p_country USING ERRCODE = 'check_violation';
  END IF;
  IF p_value IS NULL OR p_value <= 0 OR p_unit NOT IN ('days', 'months') THEN
    RAISE EXCEPTION 'retention_rule_period: a period is a whole number of days or months above zero' USING ERRCODE = 'check_violation';
  END IF;
  v_months := CASE WHEN p_unit = 'months' THEN p_value ELSE ceil(p_value / 30.0)::integer END;
  IF v_months > 600 THEN
    RAISE EXCEPTION 'retention_rule_ceiling: a period above fifty years is refused' USING ERRCODE = 'check_violation';
  END IF;
  IF p_kind IN ('bookkeeping', 'host_bookkeeping') AND (p_unit <> 'months' OR p_value < 60) THEN
    RAISE EXCEPTION 'retention_rule_floor: bookkeeping data is kept at least five years (60 months)' USING ERRCODE = 'check_violation';
  END IF;
  IF p_valid_from IS NULL OR p_checked_on IS NULL THEN
    RAISE EXCEPTION 'retention_rule_dates: a rule needs the date it starts and the date it was checked' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('retention_rule:' || p_kind || ':' || coalesce(p_country, '__'), 0));

  SELECT max(r.valid_from) INTO v_latest FROM commerce.retention_rules r
   WHERE r.kind = p_kind AND coalesce(r.country, '__') = coalesce(p_country, '__');
  IF v_latest IS NOT NULL AND p_valid_from <= v_latest THEN
    RAISE EXCEPTION 'retention_rule_backdated: the new rule must start after the latest one (%)', v_latest USING ERRCODE = 'check_violation';
  END IF;

  SELECT r.period_value, r.period_unit, r.enforced_by INTO v_previous FROM commerce.retention_rules r
   WHERE r.kind = p_kind AND coalesce(r.country, '__') = coalesce(p_country, '__') AND r.valid_to IS NULL;

  UPDATE commerce.retention_rules SET valid_to = p_valid_from
   WHERE kind = p_kind AND coalesce(country, '__') = coalesce(p_country, '__') AND valid_to IS NULL;

  INSERT INTO commerce.retention_rules (kind, country, period_value, period_unit, counts_from, source, source_url, basis, checked_on, valid_from, enforced_by, note, created_by)
  VALUES (p_kind, p_country, p_value, p_unit, p_counts_from, p_source, p_source_url, p_basis, p_checked_on, p_valid_from,
          coalesce(p_enforced_by, v_previous.enforced_by, 'runRetention'), coalesce(p_note, ''), p_account)
  RETURNING id INTO v_id;

  INSERT INTO commerce.audit_log (store_id, account_id, action, area, details)
  VALUES (NULL, p_account, 'retention.rule_set', 'platform', jsonb_build_object(
    'kind', p_kind, 'country', p_country, 'period_value', p_value, 'period_unit', p_unit,
    'previous_value', v_previous.period_value, 'previous_unit', v_previous.period_unit,
    'valid_from', p_valid_from, 'basis', p_basis, 'checked_on', p_checked_on));
  RETURN v_id;
END;
$$;
--> statement-breakpoint

-- A person has checked a rule (with an accountant): who and when. Once; a later change is a new rule.
CREATE FUNCTION commerce.verify_retention_rule(p_id uuid, p_account uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_kind text;
  v_country char(2);
BEGIN
  IF p_account IS NULL THEN
    RAISE EXCEPTION 'retention_rule_verified: a review names the person who made it' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE commerce.retention_rules SET verified_by = p_account, verified_at = now()
   WHERE id = p_id AND verified_at IS NULL
  RETURNING kind, country INTO v_kind, v_country;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'retention_rule_verified: no such rule, or it is already reviewed' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO commerce.audit_log (store_id, account_id, action, area, details)
  VALUES (NULL, p_account, 'retention.rule_verified', 'platform', jsonb_build_object('rule', p_id, 'kind', v_kind, 'country', v_country));
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Privacy requests
-- ---------------------------------------------------------------------------

CREATE FUNCTION commerce.privacy_requests_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- The retention job's one deletion: a request answered more than 24 months ago.
    IF OLD.completed_at IS NULL OR OLD.completed_at >= now() - interval '24 months' THEN
      RAISE EXCEPTION 'privacy_request_kept: a request is kept for 24 months after it was answered' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- The clock runs from receipt: one month, the same day of the next month (clamped to its last day).
    NEW.due_at := coalesce(NEW.due_at, NEW.received_at + interval '1 month');
    IF NEW.extended_until IS NOT NULL THEN
      RAISE EXCEPTION 'privacy_request_extension: a request is extended after it is logged, with a reason' USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id OR NEW.kind <> OLD.kind OR NEW.channel <> OLD.channel
     OR NEW.received_at <> OLD.received_at OR NEW.due_at <> OLD.due_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'privacy_request_fixed: a request keeps its store, kind, channel and dates (a mistake is cancelled and logged again)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status <> 'open' THEN
    -- An answered request is a record: only the address and the account's id may be forgotten (set to null).
    IF NEW.status <> OLD.status OR NEW.outcome IS DISTINCT FROM OLD.outcome OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
       OR NEW.refusal_reason IS DISTINCT FROM OLD.refusal_reason OR NEW.refusal_note IS DISTINCT FROM OLD.refusal_note
       OR NEW.extended_until IS DISTINCT FROM OLD.extended_until OR NEW.extension_reason IS DISTINCT FROM OLD.extension_reason
       OR (NEW.subject_email IS DISTINCT FROM OLD.subject_email AND NEW.subject_email IS NOT NULL)
       OR (NEW.subject_customer_id IS DISTINCT FROM OLD.subject_customer_id AND NEW.subject_customer_id IS NOT NULL) THEN
      RAISE EXCEPTION 'privacy_request_answered: an answered request is a record and is not changed' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.extended_until IS DISTINCT FROM OLD.extended_until THEN
    -- Art. 12(3): once, before the month is out, with the reasons.
    IF OLD.extended_until IS NOT NULL THEN
      RAISE EXCEPTION 'privacy_request_extension: a request is extended once' USING ERRCODE = 'check_violation';
    END IF;
    IF now() > OLD.due_at THEN
      RAISE EXCEPTION 'privacy_request_extension: the extension must be told within the first month' USING ERRCODE = 'check_violation';
    END IF;
    IF length(btrim(coalesce(NEW.extension_reason, ''))) = 0 THEN
      RAISE EXCEPTION 'privacy_request_extension: an extension needs its reason' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER privacy_requests_rules BEFORE INSERT OR UPDATE OR DELETE ON commerce.privacy_requests
  FOR EACH ROW EXECUTE FUNCTION commerce.privacy_requests_rules();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The immutability rules of other units give way to the anonymising path, and only to it
-- (each patches the live definition: one block at a known anchor, idempotent, failing loudly when the anchor is gone)
-- ---------------------------------------------------------------------------

-- VAT is frozen once an order leaves pending payment (D157); the buyer's VAT number and VIES's answer inside the treatment may be removed.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.orders_vat_frozen()'::regprocedure);
  IF position('commerce.anonymising' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    'OR NEW.vat_treatment IS DISTINCT FROM OLD.vat_treatment',
    'OR (NEW.vat_treatment IS DISTINCT FROM OLD.vat_treatment AND current_setting(''commerce.anonymising'', true) IS DISTINCT FROM ''on'')'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'orders_vat_frozen: the vat_treatment test was not found, so anonymising cannot pass it'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- A copied order is history (D129): only its personal fields may be anonymised, never its money or where it came from.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.copied_orders_read_only()'::regprocedure);
  IF position('commerce.anonymising' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'  IF NEW.copied_from IS DISTINCT FROM OLD.copied_from\n',
    E'  IF current_setting(''commerce.anonymising'', true) = ''on'' AND NEW.copied_from IS NOT DISTINCT FROM OLD.copied_from\n'
    || E'     AND (to_jsonb(NEW) - ARRAY[''customer_id'', ''email'', ''billing_address'', ''shipping_address'', ''company_name'', ''organisation_number'', ''vat_treatment'', ''delivery'', ''anonymised_at'', ''restricted_at''])\n'
    || E'         IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY[''customer_id'', ''email'', ''billing_address'', ''shipping_address'', ''company_name'', ''organisation_number'', ''vat_treatment'', ''delivery'', ''anonymised_at'', ''restricted_at'']) THEN\n'
    || E'    RETURN NEW;\n  END IF;\n'
    || E'  IF NEW.copied_from IS DISTINCT FROM OLD.copied_from\n'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'copied_orders_read_only: its first test was not found, so anonymising cannot pass it'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- A withdrawal request's name and email are not changed afterwards (D153); they may be anonymised.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.withdrawal_requests_rules()'::regprocedure);
  IF position('commerce.anonymising' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    'NEW.name IS DISTINCT FROM OLD.name OR NEW.email IS DISTINCT FROM OLD.email',
    '((NEW.name IS DISTINCT FROM OLD.name OR NEW.email IS DISTINCT FROM OLD.email) AND current_setting(''commerce.anonymising'', true) IS DISTINCT FROM ''on'')'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'withdrawal_requests_rules: the name and email test was not found, so anonymising cannot pass it'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- A return's free-text notes (and the carrier's label address) may be anonymised, in any status, and nothing else.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.returns_rules()'::regprocedure);
  IF position('commerce.anonymising' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'  -- UPDATE ---',
    E'  IF current_setting(''commerce.anonymising'', true) = ''on'' THEN\n'
    || E'    IF (to_jsonb(NEW) - ARRAY[''reason_note'', ''decision_note'', ''staff_note'', ''refund_note'', ''label_url'', ''updated_at''])\n'
    || E'       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY[''reason_note'', ''decision_note'', ''staff_note'', ''refund_note'', ''label_url'', ''updated_at'']) THEN\n'
    || E'      RAISE EXCEPTION ''return_fixed: only the free-text notes of a return are anonymised'' USING ERRCODE = ''check_violation'';\n'
    || E'    END IF;\n    RETURN NEW;\n  END IF;\n'
    || E'  -- UPDATE ---'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'returns_rules: the update branch was not found, so anonymising cannot pass it'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- A VAT number check is a record (D157) that is not changed; its buyer's name, address and number may be anonymised.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.vat_checks_immutable()'::regprocedure);
  IF position('commerce.anonymising' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'BEGIN\n',
    E'BEGIN\n  IF current_setting(''commerce.anonymising'', true) = ''on''\n'
    || E'     AND (to_jsonb(NEW) - ARRAY[''name'', ''address'', ''number'']) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY[''name'', ''address'', ''number'']) THEN\n'
    || E'    RETURN NEW;\n  END IF;\n'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'vat_checks_immutable: its body was not found, so anonymising cannot pass it'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- An order's events are append-only; only the free text staff typed into one (data.reason of a cancellation or refund, data.note of a note) may be
-- removed, and only by the anonymising path (a refund's reason is anonymised in the same function).
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.forbid_change()'::regprocedure);
  IF position('commerce.anonymising' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    E'BEGIN\n',
    E'BEGIN\n  IF TG_TABLE_NAME = ''order_events'' AND TG_OP = ''UPDATE'' AND current_setting(''commerce.anonymising'', true) = ''on'' THEN\n'
    || E'    IF (to_jsonb(NEW) - ''data'') IS NOT DISTINCT FROM (to_jsonb(OLD) - ''data'')\n'
    || E'       AND ((to_jsonb(NEW) -> ''data'') - ARRAY[''reason'', ''note'']) IS NOT DISTINCT FROM ((to_jsonb(OLD) -> ''data'') - ARRAY[''reason'', ''note'']) THEN\n'
    || E'      RETURN NEW;\n    END IF;\n  END IF;\n'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'forbid_change: its body was not found, so the events cannot be anonymised'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- A restricted or anonymised order is never copied to another store.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.copy_orders(uuid, uuid, uuid, integer)'::regprocedure);
  IF position('restricted_at' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(
    v_def,
    'o.status <> ''pending_payment'' AND (p_after IS NULL OR o.id > p_after)',
    'o.status <> ''pending_payment'' AND o.restricted_at IS NULL AND o.anonymised_at IS NULL AND (p_after IS NULL OR o.id > p_after)'
  );
  IF v_new = v_def THEN RAISE EXCEPTION 'copy_orders: its order selection was not found, so restricted orders would be copied'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Orders: anchor, due date, anonymising
-- ---------------------------------------------------------------------------

-- What an order is for the schedule: 'copied' (history from another store, D129), 'unpaid' (never paid: pending payment, or cancelled
-- with no captured payment: not a sale, no law keeps it) or 'sale'.
CREATE FUNCTION commerce.order_class(p_order uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN o.copied_from IS NOT NULL THEN 'copied'
    WHEN o.status = 'pending_payment' THEN 'unpaid'
    WHEN o.status = 'cancelled' AND NOT EXISTS (
      SELECT 1 FROM commerce.payments p WHERE p.store_id = o.store_id AND p.order_id = o.id AND p.status = 'captured'
    ) THEN 'unpaid'
    ELSE 'sale'
  END
    FROM commerce.orders o WHERE o.id = p_order
$$;
--> statement-breakpoint

-- The day a sale's period starts to run: the latest of the day it was placed, paid, refunded, a document was issued or a return was refunded,
-- in the store's time zone. The documents' issue days are never later than it, so documents are always anonymised no later than their order.
CREATE FUNCTION commerce.order_anchor(p_order uuid)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT greatest(
    commerce.store_day(o.store_id, o.placed_at),
    (SELECT max(commerce.store_day(o.store_id, p.updated_at)) FROM commerce.payments p
      WHERE p.store_id = o.store_id AND p.order_id = o.id AND p.status = 'captured'),
    (SELECT max(commerce.store_day(o.store_id, rf.created_at)) FROM commerce.refunds rf
       JOIN commerce.payments p ON p.store_id = rf.store_id AND p.id = rf.payment_id
      WHERE p.store_id = o.store_id AND p.order_id = o.id),
    (SELECT max(i.issued_on) FROM commerce.invoices i WHERE i.store_id = o.store_id AND i.order_id = o.id),
    (SELECT max(c.issued_on) FROM commerce.credit_notes c
       JOIN commerce.invoices i ON i.store_id = c.store_id AND i.id = c.invoice_id
      WHERE i.store_id = o.store_id AND i.order_id = o.id),
    (SELECT max(commerce.store_day(o.store_id, r.refunded_at)) FROM commerce.returns r
      WHERE r.store_id = o.store_id AND r.order_id = o.id AND r.refunded_at IS NOT NULL)
  )
    FROM commerce.orders o WHERE o.id = p_order
$$;
--> statement-breakpoint

-- The earliest day an order's personal data may go (for the schedule; an erasure anonymises a not-a-sale or copied order at once): an unpaid
-- order, its placed day plus the unpaid period; a sale, 1 January of (anchor year + years + 1) in the seller's country's period (never under
-- five years; a host's order has its own kind), the 1b rule: a document of year Y goes on 1 January of Y + years + 1.
CREATE FUNCTION commerce.order_anonymisable_on(p_order uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  o commerce.orders%ROWTYPE;
  v_country char(2);
  v_today date;
  v_rule record;
  v_years integer;
  v_placed date;
BEGIN
  SELECT * INTO o FROM commerce.orders x WHERE x.id = p_order;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT s.country INTO v_country FROM commerce.stores s WHERE s.id = o.store_id;
  v_today := commerce.store_day(o.store_id, now());
  v_placed := commerce.store_day(o.store_id, o.placed_at);
  IF commerce.order_class(p_order) = 'unpaid' THEN
    SELECT * INTO v_rule FROM commerce.retention_rule('unpaid_orders', v_country, v_today);
    RETURN CASE WHEN v_rule.period_unit = 'months' THEN (v_placed + make_interval(months => v_rule.period_value))::date
                ELSE v_placed + v_rule.period_value END;
  END IF;
  SELECT * INTO v_rule FROM commerce.retention_rule(CASE WHEN o.host_id IS NOT NULL THEN 'host_bookkeeping' ELSE 'bookkeeping' END, v_country, v_today);
  v_years := greatest(ceil(CASE WHEN v_rule.period_unit = 'months' THEN v_rule.period_value / 12.0 ELSE v_rule.period_value / 365.0 END)::integer, 5);
  RETURN make_date(extract(year FROM commerce.order_anchor(p_order))::integer + v_years + 1, 1, 1);
END;
$$;
--> statement-breakpoint

-- Anonymises or restricts one order (UPDATE only; the order is never deleted, D141, and its number, amounts, VAT and lines never change).
-- 'retention': anonymises, and raises anonymise_not_due unless its day has come. 'erasure': anonymises an order that is not a sale (unpaid)
-- or copied, and a sale whose period is over; any other sale is restricted (restricted_at, cut loose from the person: customer_id null).
-- Returns 'anonymised', 'restricted' or 'already' (done before).
CREATE FUNCTION commerce.anonymise_order(p_store uuid, p_order uuid, p_mode text)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  o commerce.orders%ROWTYPE;
  v_class text;
  v_due date;
  v_today date;
BEGIN
  IF p_mode NOT IN ('erasure', 'retention') THEN
    RAISE EXCEPTION 'anonymise_mode: the mode is erasure or retention' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO o FROM commerce.orders x WHERE x.id = p_order AND x.store_id = p_store FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'anonymise_order: no such order in this store' USING ERRCODE = 'no_data_found';
  END IF;
  IF o.anonymised_at IS NOT NULL THEN RETURN 'already'; END IF;
  v_class := commerce.order_class(p_order);
  v_today := commerce.store_day(p_store, now());
  v_due := commerce.order_anonymisable_on(p_order);

  IF p_mode = 'retention' THEN
    IF v_due > v_today THEN
      RAISE EXCEPTION 'anonymise_not_due: the order is kept until %', v_due USING ERRCODE = 'check_violation';
    END IF;
  ELSIF v_class = 'sale' AND v_due > v_today THEN
    -- A sale the bookkeeping duty keeps: restricted, not anonymised.
    IF o.restricted_at IS NOT NULL THEN RETURN 'already'; END IF;
    UPDATE commerce.orders SET restricted_at = now(), customer_id = NULL WHERE id = p_order;
    INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
    VALUES (p_store, p_order, 'order.restricted', jsonb_build_object('until', v_due), 'system');
    RETURN 'restricted';
  END IF;

  PERFORM set_config('commerce.anonymising', 'on', true);
  UPDATE commerce.orders SET
    email = '[removed]',
    billing_address = '{}'::jsonb,
    shipping_address = '{}'::jsonb,
    company_name = NULL,
    organisation_number = NULL,
    customer_id = NULL,
    -- The buyer's VAT number and what VIES answered about them; the kind, reason, relief and seller's side stay.
    vat_treatment = CASE WHEN vat_treatment IS NULL THEN NULL ELSE
      jsonb_set(jsonb_set(jsonb_set(vat_treatment, '{buyerVatNumber}', 'null'::jsonb, false),
                          '{vies,registeredName}', 'null'::jsonb, false),
                '{vies,registeredAddress}', 'null'::jsonb, false) END,
    -- The postal code the delivery was priced for is the delivery address's: the service and its price stay.
    delivery = CASE WHEN delivery IS NULL THEN NULL ELSE delivery - 'postalCode' END,
    anonymised_at = now()
   WHERE id = p_order;
  UPDATE commerce.withdrawal_requests SET name = '[removed]', email = '[removed]'
   WHERE store_id = p_store AND order_id = p_order AND (name <> '[removed]' OR email <> '[removed]');
  UPDATE commerce.returns SET
    reason_note = CASE WHEN coalesce(reason_note, '') = '' THEN reason_note ELSE '[removed]' END,
    decision_note = CASE WHEN coalesce(decision_note, '') = '' THEN decision_note ELSE '[removed]' END,
    staff_note = CASE WHEN coalesce(staff_note, '') = '' THEN staff_note ELSE '[removed]' END,
    refund_note = CASE WHEN coalesce(refund_note, '') = '' THEN refund_note ELSE '[removed]' END,
    label_url = NULL
   WHERE store_id = p_store AND order_id = p_order;
  -- Free text staff typed: a refund's reason and the reason or note of an event (a name can be in them). The system's own reasons of refunds made in Stripe stay.
  UPDATE commerce.refunds r SET reason = '[removed]'
   WHERE r.store_id = p_store AND r.reason <> '[removed]' AND r.reason NOT IN ('Refunded in Stripe', 'Refund recorded from Stripe')
     AND r.payment_id IN (SELECT p.id FROM commerce.payments p WHERE p.store_id = p_store AND p.order_id = p_order);
  UPDATE commerce.order_events e SET data = e.data - ARRAY['reason', 'note']
   WHERE e.store_id = p_store AND e.order_id = p_order AND (e.data ? 'reason' OR e.data ? 'note');
  -- The check of the buyer's VAT number, when no other order or cart still uses it (a check is shared by the orders of one cart only).
  UPDATE commerce.vat_checks SET name = NULL, address = NULL, number = country_prefix || '**'
   WHERE store_id = p_store AND id = o.vat_check_id AND purpose = 'buyer' AND number <> country_prefix || '**'
     AND NOT EXISTS (SELECT 1 FROM commerce.orders x WHERE x.store_id = p_store AND x.vat_check_id = vat_checks.id AND x.id <> p_order AND x.anonymised_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM commerce.carts c WHERE c.store_id = p_store AND c.vat_check_id = vat_checks.id);
  PERFORM set_config('commerce.anonymising', '', true);

  -- A copied order's events are refused by its own rule (it is history, with no events of its own).
  IF o.copied_from IS NULL THEN
    INSERT INTO commerce.order_events (store_id, order_id, type, data, actor)
    VALUES (p_store, p_order, 'order.anonymised', jsonb_build_object('mode', p_mode, 'was_restricted', o.restricted_at IS NOT NULL), 'system');
  END IF;
  RETURN 'anonymised';
END;
$$;
--> statement-breakpoint

-- The schedule: orders whose day has come, oldest first, at most p_limit (so the first run on a large store spreads over days). Refuses a
-- day after the store's own today. Idempotent. Returns how many were anonymised. No DELETE: the application removes files and other rows.
CREATE FUNCTION commerce.anonymise_expired_orders(p_store uuid, p_today date, p_limit integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  r record;
  v_n integer := 0;
  v_real date;
  v_country char(2);
  v_years integer;
  v_cutoff timestamp;
BEGIN
  v_real := commerce.store_day(p_store, now());
  IF p_today IS NULL OR p_today > v_real THEN
    RAISE EXCEPTION 'anonymise_today: the schedule is run for the store''s own day or an earlier one, not %', p_today USING ERRCODE = 'check_violation';
  END IF;
  -- A sale of year Y goes on 1 January of Y + years + 1, so nothing placed on or after 1 January of (this year - years) can be due: the shortest of the
  -- store's own periods (a host's order has its own, longer one; never under five years) bounds the candidates, with a day's margin for the store's time zone.
  SELECT s.country INTO v_country FROM commerce.stores s WHERE s.id = p_store;
  SELECT least(
           (SELECT greatest(ceil(CASE WHEN x.period_unit = 'months' THEN x.period_value / 12.0 ELSE x.period_value / 365.0 END)::integer, 5)
              FROM commerce.retention_rule('bookkeeping', v_country, p_today) x),
           (SELECT greatest(ceil(CASE WHEN x.period_unit = 'months' THEN x.period_value / 12.0 ELSE x.period_value / 365.0 END)::integer, 5)
              FROM commerce.retention_rule('host_bookkeeping', v_country, p_today) x)
         ) INTO v_years;
  v_cutoff := make_timestamp(extract(year FROM p_today)::integer - v_years, 1, 1, 0, 0, 0) + interval '1 day';
  -- The candidates are read in order into a set first and the (dearer) due-day function is asked of them one by one until the limit is
  -- reached, so a store with a hundred thousand old orders is not asked about all of them every day.
  FOR r IN
    WITH cand AS MATERIALIZED (
      SELECT o.id, o.placed_at FROM commerce.orders o
       WHERE o.store_id = p_store AND o.anonymised_at IS NULL
         AND (o.status IN ('pending_payment', 'cancelled') OR o.placed_at < v_cutoff)
       ORDER BY o.placed_at, o.id
    )
    SELECT c.id FROM cand c
     WHERE commerce.order_anonymisable_on(c.id) <= p_today
     LIMIT greatest(p_limit, 1)
  LOOP
    IF commerce.anonymise_order(p_store, r.id, 'retention') = 'anonymised' THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The plan comparison (D132) describes the feature; it enables nothing.
-- ---------------------------------------------------------------------------
INSERT INTO commerce.plan_features (category, name, description, position)
SELECT v.category, v.name, v.description, v.position
  FROM (VALUES
    ('Operations', 'GDPR data export and erasure and a data retention schedule', 'A customer''s data as one downloadable file for staff and for the shopper, erasure that keeps what bookkeeping law requires and then anonymises it, a log of privacy requests with the one-month clock, and a retention schedule with its sources.', 484)
  ) AS v(category, name, description, position)
 WHERE NOT EXISTS (SELECT 1 FROM commerce.plan_features f WHERE f.name = v.name);

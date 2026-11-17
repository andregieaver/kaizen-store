-- Forms as their own records (D705, `docs/forms.md`): the rules the database holds.
--
-- A form keeps its store and its kind. A response takes its form's store, and once written only its state changes; it goes with its form,
-- by erasure or by the retention job.

CREATE FUNCTION commerce.forms_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    RAISE EXCEPTION 'forms.store: a form keeps its store' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'forms.kind: a form keeps its kind' USING ERRCODE = 'check_violation';
  END IF;
  NEW.created_at := OLD.created_at;
  NEW.created_by := OLD.created_by;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER forms_rules BEFORE UPDATE ON commerce.forms FOR EACH ROW EXECUTE FUNCTION commerce.forms_rules();
--> statement-breakpoint

CREATE FUNCTION commerce.form_responses_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT f.store_id INTO NEW.store_id FROM commerce.forms f WHERE f.id = NEW.form_id;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.form_id IS DISTINCT FROM OLD.form_id
     OR NEW.answers IS DISTINCT FROM OLD.answers OR NEW.contact_email IS DISTINCT FROM OLD.contact_email OR NEW.path IS DISTINCT FROM OLD.path
     OR NEW.locale IS DISTINCT FROM OLD.locale OR NEW.delivery IS DISTINCT FROM OLD.delivery OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'form_responses.fixed: a response keeps what was sent; only its state changes' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER form_responses_rules BEFORE INSERT OR UPDATE ON commerce.form_responses FOR EACH ROW EXECUTE FUNCTION commerce.form_responses_rules();
--> statement-breakpoint

-- RLS on, as on every commerce table: the Data API does not expose the schema, and server code reaches it through its own connection.
ALTER TABLE commerce.forms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.form_responses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

INSERT INTO commerce.retention_rules (kind, country, period_value, period_unit, counts_from, source, source_url, basis, checked_on, valid_from, enforced_by, note)
SELECT 'form_responses', NULL, 36, 'months', 'event', 'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.', NULL, 'policy', '2026-11-17', '2000-01-01', 'runRetention: form_responses',
   'What visitors sent with a form, counted from when it was sent: deleted after the form''s own months (1 to 36, 12 unless the owner chose), never later than this rule. FORM_KEEP_MONTHS_MAX, a test holds them equal.'
 WHERE NOT EXISTS (SELECT 1 FROM commerce.retention_rules r WHERE r.kind = 'form_responses' AND r.country IS NULL);

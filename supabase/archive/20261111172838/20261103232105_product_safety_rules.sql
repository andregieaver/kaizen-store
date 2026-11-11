-- D452 (docs/product-safety-eea.md): EU and EEA membership as two classifications, and what the General Product Safety Regulation asks
-- per destination of a product whose manufacturer is established elsewhere. The publish check (`assert_product_publishable`) now asks for
-- a responsible person by the store's destinations and their configured rule, instead of "an EU one whenever the maker is outside the
-- EU". To change a rule (for instance once the GPSR is incorporated into the EEA Agreement and in force in Norway), add a migration that
-- updates `product_safety_rules` for that destination; `src/lib/product-safety.ts` reads the same rows.

-- The two classifications, for every country a company may be established in. EU member states (27, checked 3 November 2026), then
-- the EEA EFTA states. Neither column is ever worked out from the other.
INSERT INTO commerce.country_memberships (code, eu, eea) VALUES
  ('AT', true, true), ('BE', true, true), ('BG', true, true), ('HR', true, true), ('CY', true, true), ('CZ', true, true),
  ('DK', true, true), ('EE', true, true), ('FI', true, true), ('FR', true, true), ('DE', true, true), ('GR', true, true),
  ('HU', true, true), ('IE', true, true), ('IT', true, true), ('LV', true, true), ('LT', true, true), ('LU', true, true),
  ('MT', true, true), ('NL', true, true), ('PL', true, true), ('PT', true, true), ('RO', true, true), ('SK', true, true),
  ('SI', true, true), ('ES', true, true), ('SE', true, true),
  ('NO', false, true), ('IS', false, true), ('LI', false, true);
--> statement-breakpoint

-- The EU: the GPSR applies since 13 December 2024 and asks for a responsible person established in the Union (Art. 16(1)).
INSERT INTO commerce.product_safety_rules (destination, responsible_person, status, legal_basis, source, reviewed_on, note)
SELECT code, 'eu', 'in_force', 'Regulation (EU) 2023/988, Art. 16(1) and 19; applies from 13 December 2024',
       'https://eur-lex.europa.eu/eli/reg/2023/988/oj', DATE '2026-11-03',
       'Establishment in an EEA EFTA state does not satisfy it.'
  FROM commerce.country_memberships WHERE eu;
--> statement-breakpoint

-- The EEA EFTA states: not incorporated into the EEA Agreement (EEA-Lex: under scrutiny; Norway's EEA note of 27 January 2026: needs a
-- change in law and the Storting's consent). The general product safety rules there are still national law implementing Directive
-- 2001/95/EC, which has no responsible person, so the GPSR asks for none there yet.
INSERT INTO commerce.product_safety_rules (destination, responsible_person, status, legal_basis, source, reviewed_on, note) VALUES
  ('NO', 'none', 'not_incorporated', 'Regulation (EU) 2023/988 not incorporated into the EEA Agreement; produktkontrolloven (Directive 2001/95/EC) applies',
   'https://www.efta.int/eea-lex/32023r0988 ; https://www.regjeringen.no/no/sub/eos-notatbasen/notatene/2024/juli/produktsikkerhetsforordningen/id3147443/', DATE '2026-11-03',
   'When incorporated and in force, set to eea (or as the Joint Committee decision adapts Art. 16).'),
  ('IS', 'none', 'not_incorporated', 'Regulation (EU) 2023/988 not incorporated into the EEA Agreement; national law implementing Directive 2001/95/EC applies',
   'https://www.efta.int/eea-lex/32023r0988', DATE '2026-11-03',
   'When incorporated and in force, set to eea (or as the Joint Committee decision adapts Art. 16).'),
  ('LI', 'none', 'not_incorporated', 'Regulation (EU) 2023/988 not incorporated into the EEA Agreement; national law implementing Directive 2001/95/EC applies',
   'https://www.efta.int/eea-lex/32023r0988', DATE '2026-11-03',
   'When incorporated and in force, set to eea (or as the Joint Committee decision adapts Art. 16).');
--> statement-breakpoint

CREATE FUNCTION commerce.is_established_in(p_area text, p_code char(2))
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce((
    SELECT CASE p_area WHEN 'eu' THEN m.eu WHEN 'eea' THEN m.eea ELSE false END
      FROM commerce.country_memberships m WHERE m.code = p_code
  ), false);
$$;
--> statement-breakpoint

-- The areas a responsible person must be established in for a manufacturer in p_maker selling into the store's active countries: a
-- destination without a rule is held to 'eu' when it is an EU member state, else asks for nothing (as `ruleFor()` in TypeScript).
CREATE FUNCTION commerce.responsible_person_areas(p_store uuid, p_maker char(2))
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(array_agg(DISTINCT t.area ORDER BY t.area DESC), '{}')
    FROM (
      SELECT coalesce(r.responsible_person, CASE WHEN commerce.is_established_in('eu', mk.code) THEN 'eu' ELSE 'none' END) AS area
        FROM commerce.markets mk
        LEFT JOIN commerce.product_safety_rules r ON r.destination = mk.code
       WHERE mk.store_id = p_store AND mk.active
    ) t
   WHERE t.area <> 'none' AND NOT commerce.is_established_in(t.area, p_maker);
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.assert_product_publishable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_manufacturer_country char(2);
  v_responsible_country char(2);
  v_areas text[];
  v_area text;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  -- GPSR covers physical goods: a product sold only as downloads needs no
  -- manufacturer or responsible person (D24).
  IF NOT EXISTS (
    SELECT 1 FROM commerce.product_variants
     WHERE product_id = NEW.id AND active AND delivery = 'physical'
  ) THEN
    v_manufacturer_country := NULL;
  ELSIF NEW.manufacturer_id IS NULL THEN
    RAISE EXCEPTION 'product % cannot be active without a manufacturer', NEW.handle
      USING ERRCODE = 'check_violation';
  ELSE
    SELECT country INTO v_manufacturer_country
      FROM commerce.economic_operators
     WHERE store_id = NEW.store_id AND id = NEW.manufacturer_id;
  END IF;

  -- A responsible person established in each area the store's destinations ask for (D452).
  IF v_manufacturer_country IS NOT NULL THEN
    v_areas := commerce.responsible_person_areas(NEW.store_id, v_manufacturer_country);
    IF cardinality(v_areas) > 0 THEN
      SELECT country INTO v_responsible_country
        FROM commerce.economic_operators
       WHERE store_id = NEW.store_id AND id = NEW.responsible_person_id;
      FOREACH v_area IN ARRAY v_areas LOOP
        IF NOT commerce.is_established_in(v_area, v_responsible_country) THEN
          IF v_area = 'eu' THEN
            RAISE EXCEPTION 'product % has a manufacturer outside the EU and needs an EU responsible person', NEW.handle
              USING ERRCODE = 'check_violation';
          ELSE
            RAISE EXCEPTION 'product % has a manufacturer outside the EEA and needs an EEA responsible person', NEW.handle
              USING ERRCODE = 'check_violation';
          END IF;
        END IF;
      END LOOP;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM commerce.product_media WHERE product_id = NEW.id) THEN
    RAISE EXCEPTION 'product % cannot be active without a picture', NEW.handle
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM commerce.product_translations
     WHERE product_id = NEW.id AND btrim(title) <> ''
  ) THEN
    RAISE EXCEPTION 'product % cannot be active without a title', NEW.handle
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM commerce.product_variants
     WHERE product_id = NEW.id AND active
  ) THEN
    RAISE EXCEPTION 'product % cannot be active without an active variant', NEW.handle
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

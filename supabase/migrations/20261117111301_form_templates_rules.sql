-- Form templates (D705 F4, `docs/forms.md` 12): the rules the database holds, and Kaizena Flow's seven starters as its own templates.
--
-- A template keeps its store, its kind and its starter key. The form it is updated from is one of its own store's. Kaizena Flow's are
-- always the marketplace's (a check on the table).

CREATE FUNCTION commerce.form_templates_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.store_id IS DISTINCT FROM OLD.store_id THEN
      RAISE EXCEPTION 'form_templates.store: a template keeps its store' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind IS DISTINCT FROM OLD.kind THEN
      RAISE EXCEPTION 'form_templates.kind: a template keeps its kind' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.starter IS DISTINCT FROM OLD.starter THEN
      RAISE EXCEPTION 'form_templates.starter: a starter keeps its key' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := now();
  END IF;
  IF NEW.form_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.forms f WHERE f.id = NEW.form_id AND f.store_id IS NOT DISTINCT FROM NEW.store_id AND f.kind = NEW.kind
  ) THEN
    RAISE EXCEPTION 'form_templates.form: a template is updated only from a form of its own store and kind' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER form_templates_rules BEFORE INSERT OR UPDATE ON commerce.form_templates FOR EACH ROW EXECUTE FUNCTION commerce.form_templates_rules();
--> statement-breakpoint

-- RLS on, as on every commerce table: the Data API does not expose the schema, and server code reaches it through its own connection.
ALTER TABLE commerce.form_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Kaizena Flow's starters, in English with Norwegian, Swedish and Danish beside (made from `FORM_STARTERS` in `src/lib/form-records.ts`).
-- Written once: the platform's own edits are kept from then on.
INSERT INTO commerce.form_templates (starter, kind, category, name, description, content, sharing, lang)
SELECT v.starter, v.kind, v.category, v.name, v.description, v.content, 'marketplace', 'en'
FROM (VALUES
  ('contact', 'message', 'contact', '{"text":"Contact","byLocale":{"nb":"Kontakt","sv":"Kontakt","da":"Kontakt"}}'::jsonb, '{"text":"Name, email and a message.","byLocale":{"nb":"Navn, e-post og en melding.","sv":"Namn, e-post och ett meddelande.","da":"Navn, e-mail og en besked."}}'::jsonb, '{"questions":[{"id":"q1","kind":"name","label":{"text":"","byLocale":{}},"required":true},{"id":"q2","kind":"email","label":{"text":"","byLocale":{}},"required":true},{"id":"q3","kind":"textarea","label":{"text":"","byLocale":{}},"required":true}],"words":{},"signup":null,"keepMonths":12}'::jsonb),
  ('quote', 'message', 'sales', '{"text":"Quote request","byLocale":{"nb":"Be om tilbud","sv":"Offertförfrågan","da":"Tilbudsforespørgsel"}}'::jsonb, '{"text":"What they need, with company and phone.","byLocale":{"nb":"Hva de trenger, med firma og telefon.","sv":"Vad de behöver, med företag och telefon.","da":"Hvad de har brug for, med firma og telefon."}}'::jsonb, '{"questions":[{"id":"q1","kind":"name","label":{"text":"","byLocale":{}},"required":true},{"id":"q2","kind":"text","label":{"text":"Company","byLocale":{"nb":"Firma","sv":"Företag","da":"Firma"}}},{"id":"q3","kind":"email","label":{"text":"","byLocale":{}},"required":true},{"id":"q4","kind":"phone","label":{"text":"","byLocale":{}}},{"id":"q5","kind":"textarea","label":{"text":"What do you need?","byLocale":{"nb":"Hva trenger du?","sv":"Vad behöver du?","da":"Hvad har du brug for?"}},"required":true}],"words":{},"signup":null,"keepMonths":12}'::jsonb),
  ('booking', 'message', 'bookings', '{"text":"Booking enquiry","byLocale":{"nb":"Bookingforespørsel","sv":"Bokningsförfrågan","da":"Bookingforespørgsel"}}'::jsonb, '{"text":"A preferred date and how many.","byLocale":{"nb":"Ønsket dato og hvor mange.","sv":"Önskat datum och hur många.","da":"Ønsket dato og hvor mange."}}'::jsonb, '{"questions":[{"id":"q1","kind":"name","label":{"text":"","byLocale":{}},"required":true},{"id":"q2","kind":"email","label":{"text":"","byLocale":{}},"required":true},{"id":"q3","kind":"phone","label":{"text":"","byLocale":{}}},{"id":"q4","kind":"text","label":{"text":"Preferred date","byLocale":{"nb":"Ønsket dato","sv":"Önskat datum","da":"Ønsket dato"}},"required":true},{"id":"q5","kind":"select","label":{"text":"How many people?","byLocale":{"nb":"Hvor mange personer?","sv":"Hur många personer?","da":"Hvor mange personer?"}},"options":[{"text":"1","byLocale":{}},{"text":"2","byLocale":{}},{"text":"3–5","byLocale":{}},{"text":"6–10","byLocale":{}},{"text":"More than 10","byLocale":{"nb":"Flere enn 10","sv":"Fler än 10","da":"Flere end 10"}}]},{"id":"q6","kind":"textarea","label":{"text":"","byLocale":{}}}],"words":{},"signup":null,"keepMonths":12}'::jsonb),
  ('callback', 'message', 'contact', '{"text":"Call me back","byLocale":{"nb":"Ring meg opp","sv":"Ring upp mig","da":"Ring mig op"}}'::jsonb, '{"text":"A phone number and the best time to call.","byLocale":{"nb":"Et telefonnummer og når det passer å ringe.","sv":"Ett telefonnummer och när det passar att ringa.","da":"Et telefonnummer og hvornår det passer at ringe."}}'::jsonb, '{"questions":[{"id":"q1","kind":"name","label":{"text":"","byLocale":{}},"required":true},{"id":"q2","kind":"phone","label":{"text":"","byLocale":{}},"required":true},{"id":"q3","kind":"select","label":{"text":"Best time to call","byLocale":{"nb":"Når passer det best?","sv":"När passar det bäst?","da":"Hvornår passer det bedst?"}},"options":[{"text":"Morning","byLocale":{"nb":"Formiddag","sv":"Förmiddag","da":"Formiddag"}},{"text":"Afternoon","byLocale":{"nb":"Ettermiddag","sv":"Eftermiddag","da":"Eftermiddag"}},{"text":"Evening","byLocale":{"nb":"Kveld","sv":"Kväll","da":"Aften"}}]}],"words":{},"signup":null,"keepMonths":12}'::jsonb),
  ('feedback', 'message', 'feedback', '{"text":"Feedback","byLocale":{"nb":"Tilbakemelding","sv":"Feedback","da":"Feedback"}}'::jsonb, '{"text":"How it went, in their own words.","byLocale":{"nb":"Hvordan det gikk, med egne ord.","sv":"Hur det gick, med egna ord.","da":"Hvordan det gik, med egne ord."}}'::jsonb, '{"questions":[{"id":"q1","kind":"select","label":{"text":"How was it?","byLocale":{"nb":"Hvordan var det?","sv":"Hur var det?","da":"Hvordan var det?"}},"required":true,"options":[{"text":"Very good","byLocale":{"nb":"Veldig bra","sv":"Mycket bra","da":"Meget godt"}},{"text":"Good","byLocale":{"nb":"Bra","sv":"Bra","da":"Godt"}},{"text":"Not so good","byLocale":{"nb":"Ikke så bra","sv":"Inte så bra","da":"Ikke så godt"}}]},{"id":"q2","kind":"textarea","label":{"text":"Tell us more","byLocale":{"nb":"Fortell oss mer","sv":"Berätta mer","da":"Fortæl os mere"}}},{"id":"q3","kind":"email","label":{"text":"","byLocale":{}}}],"words":{},"signup":null,"keepMonths":12}'::jsonb),
  ('event', 'message', 'events', '{"text":"Event registration","byLocale":{"nb":"Påmelding til arrangement","sv":"Anmälan till evenemang","da":"Tilmelding til arrangement"}}'::jsonb, '{"text":"Who is coming, with a box to agree.","byLocale":{"nb":"Hvem som kommer, med en boks å krysse av.","sv":"Vem som kommer, med en ruta att kryssa i.","da":"Hvem der kommer, med en boks at krydse af."}}'::jsonb, '{"questions":[{"id":"q1","kind":"name","label":{"text":"","byLocale":{}},"required":true},{"id":"q2","kind":"email","label":{"text":"","byLocale":{}},"required":true},{"id":"q3","kind":"text","label":{"text":"Company","byLocale":{"nb":"Firma","sv":"Företag","da":"Firma"}}},{"id":"q4","kind":"textarea","label":{"text":"Allergies or other needs","byLocale":{"nb":"Allergier eller andre behov","sv":"Allergier eller andra behov","da":"Allergier eller andre behov"}}}],"words":{"consent":{"text":"I agree that my details are used for this event.","byLocale":{"nb":"Jeg godtar at opplysningene mine brukes til dette arrangementet.","sv":"Jag godkänner att mina uppgifter används för detta evenemang.","da":"Jeg accepterer, at mine oplysninger bruges til dette arrangement."}}},"signup":null,"keepMonths":12}'::jsonb),
  ('newsletter', 'signup', 'newsletter', '{"text":"Newsletter","byLocale":{"nb":"Nyhetsbrev","sv":"Nyhetsbrev","da":"Nyhedsbrev"}}'::jsonb, '{"text":"An email address, confirmed by the visitor.","byLocale":{"nb":"En e-postadresse, bekreftet av den besøkende.","sv":"En e-postadress, bekräftad av besökaren.","da":"En e-mailadresse, bekræftet af den besøgende."}}'::jsonb, '{"questions":[],"words":{},"signup":{"confirm":true,"askName":false},"keepMonths":12}'::jsonb)
) AS v(starter, kind, category, name, description, content)
WHERE NOT EXISTS (SELECT 1 FROM commerce.form_templates t WHERE t.starter = v.starter);

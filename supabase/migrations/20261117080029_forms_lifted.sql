-- Forms as their own records, step F2 (D705, `docs/forms.md`): a page's own email form or newsletter sign-up becomes one of its owner's
-- forms, and copies of a store take the forms its pages show.
--
-- 1. `lift_page_forms()` turns every inline email form (`emailForm`) and sign-up (`newsletter`) in pages (draft and published) and saved
--    parts, at any depth, into a row of `commerce.forms` and puts a `form` component pointing at it in its place, keeping its look (button,
--    layout, spacing and the rest). Its words carry their translations from the page (`translations.{locale}.block.{id}.…`) into the
--    form's words per language. A form's id is made from its owner and the component's id (`lifted_form_id()`), so a page's draft and
--    published copy share one form, and the site (`findForm()`) still finds it from a page drawn before the move.
-- 2. `clone_page_content()` (a new store from a template or starter) copies the template's forms its pages show, without where they send
--    or a sign-up's code and tags; `copy_remap()` (a duplicated store, D129, and Kaizena Flow's site copied into its own store, D469) copies
--    the source's forms its content names, as they are. Only the source's own forms are ever copied; responses never are.

CREATE FUNCTION commerce.lifted_form_id(p_store uuid, p_block text) RETURNS uuid
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  -- Shaped as `clone_id()` shapes its ids (version 4, variant 8), so it reads as a uuid everywhere one is checked.
  SELECT (substr(h, 1, 12) || '4' || substr(h, 14, 3) || '8' || substr(h, 18, 15))::uuid
    FROM (SELECT md5(coalesce(p_store::text, 'platform') || ':' || p_block) AS h) AS hashed;
$$;
--> statement-breakpoint

-- Words with their translations on the page: `{ text, byLocale }`.
CREATE FUNCTION commerce.lifted_words(p_content jsonb, p_key text, p_text text) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT jsonb_build_object(
    'text', coalesce(p_text, ''),
    'byLocale', coalesce((
      SELECT jsonb_object_agg(t.key, t.value ->> p_key)
        FROM jsonb_each(CASE WHEN jsonb_typeof(p_content -> 'translations') = 'object' THEN p_content -> 'translations' ELSE '{}'::jsonb END) t
       WHERE jsonb_typeof(t.value) = 'object' AND jsonb_typeof(t.value -> p_key) = 'string' AND t.value ->> p_key <> ''
    ), '{}'::jsonb)
  );
$$;
--> statement-breakpoint

-- One inline form as a form of its owner (made once; a second call for the same component finds it). Its id.
CREATE FUNCTION commerce.lift_form_block(p_store uuid, p_content jsonb, p_block jsonb, p_title text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_id uuid := commerce.lifted_form_id(p_store, p_block ->> 'id');
  v_key text := 'block.' || (p_block ->> 'id') || '.';
  v_signup boolean := p_block ->> 'type' = 'newsletter';
  v_questions jsonb := '[]'::jsonb;
  v_words jsonb;
  v_title text := coalesce(nullif(btrim(p_title), ''), 'Page');
BEGIN
  IF EXISTS (SELECT 1 FROM commerce.forms f WHERE f.id = v_id) THEN
    RETURN v_id;
  END IF;
  IF NOT v_signup AND jsonb_typeof(p_block -> 'fields') = 'array' THEN
    SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', q.f ->> 'id',
             'kind', q.f ->> 'kind',
             'label', commerce.lifted_words(p_content, v_key || (q.f ->> 'id') || '.label', q.f ->> 'label'),
             'required', CASE WHEN (q.f ->> 'required')::boolean THEN true END,
             'placeholder', CASE WHEN coalesce(q.f ->> 'placeholder', '') <> ''
                              THEN commerce.lifted_words(p_content, v_key || (q.f ->> 'id') || '.placeholder', q.f ->> 'placeholder') END,
             'options', CASE WHEN jsonb_typeof(q.f -> 'options') = 'array' THEN (
                          SELECT jsonb_agg(commerce.lifted_words(p_content, v_key || (q.f ->> 'id') || '.option' || (o.n - 1), o.v) ORDER BY o.n)
                            FROM jsonb_array_elements_text(q.f -> 'options') WITH ORDINALITY AS o(v, n)) END
           )) ORDER BY q.n), '[]'::jsonb)
      INTO v_questions
      FROM jsonb_array_elements(p_block -> 'fields') WITH ORDINALITY AS q(f, n)
     WHERE jsonb_typeof(q.f) = 'object' AND q.n <= 20;
  END IF;
  v_words := jsonb_strip_nulls(jsonb_build_object(
    'submit', commerce.lifted_words(p_content, v_key || 'submitLabel', p_block ->> 'submitLabel'),
    'success', commerce.lifted_words(p_content, v_key || 'successMessage', p_block ->> 'successMessage'),
    'consent', CASE WHEN p_block ? 'consent' THEN commerce.lifted_words(p_content, v_key || 'consent', p_block ->> 'consent') END,
    'placeholder', CASE WHEN v_signup THEN commerce.lifted_words(p_content, v_key || 'placeholder', p_block ->> 'placeholder') END
  ));
  INSERT INTO commerce.forms (id, store_id, kind, name, questions, words, delivery, signup)
  VALUES (
    v_id,
    p_store,
    CASE WHEN v_signup THEN 'signup' ELSE 'message' END,
    left((CASE WHEN v_signup THEN 'Newsletter (' ELSE 'Contact form (' END) || v_title, 79) || ')',
    v_questions,
    v_words,
    jsonb_build_object(
      'recipients', CASE WHEN jsonb_typeof(p_block -> 'recipients') = 'array' THEN p_block -> 'recipients' ELSE '[]'::jsonb END,
      'subject', coalesce(p_block ->> 'subject', '')
    ),
    CASE WHEN v_signup THEN jsonb_strip_nulls(jsonb_build_object(
      'confirm', coalesce((p_block ->> 'confirm')::boolean, true),
      'askName', coalesce((p_block ->> 'askName')::boolean, false),
      -- A sign-up's code and tags are a store's own (D304 J3); Kaizena Flow's forms give none.
      'incentive', CASE WHEN p_store IS NOT NULL THEN p_block ->> 'incentive' END,
      'tags', CASE WHEN p_store IS NOT NULL AND jsonb_typeof(p_block -> 'tags') = 'array' THEN p_block -> 'tags' END
    )) END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN v_id;
END;
$$;
--> statement-breakpoint

-- A part of a page with every inline form in it made a `form` component (the page's own translations are left as they are).
CREATE FUNCTION commerce.lift_form_node(p_store uuid, p_content jsonb, p_node jsonb, p_title text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_out jsonb;
  v_form uuid;
BEGIN
  IF jsonb_typeof(p_node) = 'array' THEN
    SELECT coalesce(jsonb_agg(commerce.lift_form_node(p_store, p_content, a.e, p_title) ORDER BY a.n), '[]'::jsonb)
      INTO v_out FROM jsonb_array_elements(p_node) WITH ORDINALITY AS a(e, n);
    RETURN v_out;
  END IF;
  IF jsonb_typeof(p_node) IS DISTINCT FROM 'object' THEN
    RETURN p_node;
  END IF;
  IF p_node ->> 'type' IN ('emailForm', 'newsletter') AND p_node ? 'recipients' AND p_node ? 'id' THEN
    v_form := commerce.lift_form_block(p_store, p_content, p_node, p_title);
    RETURN (p_node - ARRAY['recipients', 'subject', 'fields', 'submitLabel', 'successMessage', 'consent', 'askName', 'placeholder', 'confirm', 'incentive', 'tags'])
      || jsonb_build_object('type', 'form', 'formId', v_form::text);
  END IF;
  SELECT coalesce(jsonb_object_agg(e.k, CASE WHEN e.k = 'translations' THEN e.v ELSE commerce.lift_form_node(p_store, p_content, e.v, p_title) END), '{}'::jsonb)
    INTO v_out FROM jsonb_each(p_node) AS e(k, v);
  RETURN v_out;
END;
$$;
--> statement-breakpoint

-- Every page and saved part with an inline form, its forms lifted: the published copy first, so a form is made from what visitors see.
-- How many pages and parts changed.
CREATE FUNCTION commerce.lift_page_forms() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  r record;
  v_title text;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT p.id, p.store_id, p.draft, p.published FROM commerce.pages p
     WHERE p.draft::text ~ '"type": "(emailForm|newsletter)"' OR coalesce(p.published::text, '') ~ '"type": "(emailForm|newsletter)"'
  LOOP
    v_title := coalesce(r.published ->> 'title', r.draft ->> 'title', '');
    UPDATE commerce.pages
       SET published = CASE WHEN r.published IS NULL THEN NULL ELSE commerce.lift_form_node(r.store_id, r.published, r.published, v_title) END,
           draft = commerce.lift_form_node(r.store_id, r.draft, r.draft, v_title)
     WHERE id = r.id;
    n := n + 1;
  END LOOP;
  FOR r IN SELECT s.id, s.store_id, s.content, s.name FROM commerce.saved_parts s WHERE s.content::text ~ '"type": "(emailForm|newsletter)"' LOOP
    UPDATE commerce.saved_parts SET content = commerce.lift_form_node(r.store_id, r.content, r.content, r.name) WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
--> statement-breakpoint

SELECT commerce.lift_page_forms();
--> statement-breakpoint

-- A new store's copy of its template's pages (D175): the template's forms its pages show come along, without where they send or a sign-up's
-- code and tags, as the page's own forms came without their recipients.
CREATE OR REPLACE FUNCTION commerce.clone_page_content(p_store uuid, p_template uuid, p_content jsonb) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE
    SET search_path TO ''
    AS $$
DECLARE
  v_text text := p_content::text;
  v_id uuid;
BEGIN
  IF p_content IS NULL THEN
    RETURN NULL;
  END IF;
  FOR v_id IN
    SELECT id FROM commerce.terms WHERE store_id = p_template
    UNION ALL
    SELECT id FROM commerce.menus WHERE store_id = p_template
  LOOP
    v_text := replace(v_text, '"' || v_id::text || '"', '"' || commerce.clone_id(p_store, v_id)::text || '"');
  END LOOP;
  FOR v_id IN SELECT f.id FROM commerce.forms f WHERE f.store_id = p_template AND strpos(v_text, '"' || f.id::text || '"') > 0 LOOP
    INSERT INTO commerce.forms (id, store_id, kind, name, status, questions, words, delivery, signup, keep_months, made_from)
    SELECT commerce.clone_id(p_store, f.id), p_store, f.kind, f.name, f.status, f.questions, f.words,
           jsonb_set(f.delivery, '{recipients}', '[]'::jsonb), CASE WHEN f.signup IS NULL THEN NULL ELSE f.signup - 'incentive' - 'tags' END,
           f.keep_months, f.made_from
      FROM commerce.forms f WHERE f.id = v_id
    ON CONFLICT (id) DO NOTHING;
    v_text := replace(v_text, '"' || v_id::text || '"', '"' || commerce.clone_id(p_store, v_id)::text || '"');
  END LOOP;
  v_text := replace(v_text, '"' || p_template::text || '"', '"' || p_store::text || '"');
  v_text := regexp_replace(v_text, '"recipients": \[[^]]*\]', '"recipients": []', 'g');
  RETURN v_text::jsonb;
END;
$$;
--> statement-breakpoint

-- A copy's ids (D129, D469): as before, and the source's own forms the content names are copied into the new store as they are (a
-- store's copy is its owner's, and Kaizena Flow's site copied into its own store keeps its addresses), their ids made the copy's.
CREATE OR REPLACE FUNCTION commerce.copy_remap(p_json jsonb, p_source uuid, p_new uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_text text;
  v_old uuid;
  v_new uuid;
  v_found boolean;
  v_gone text[] := '{}';
BEGIN
  IF p_json IS NULL THEN
    RETURN NULL;
  END IF;
  v_text := p_json::text;
  FOR v_old IN
    SELECT DISTINCT lower(r.m[1])::uuid
      FROM regexp_matches(v_text, '"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"', 'g') AS r(m)
  LOOP
    SELECT true, c.new_id INTO v_found, v_new FROM pg_temp._copy_ids c WHERE c.old_id = v_old;
    IF v_found IS NOT TRUE THEN
      -- One of the source's forms (D705); Kaizena Flow's own when its site is copied into its own store.
      IF EXISTS (SELECT 1 FROM commerce.forms f WHERE f.id = v_old
                   AND ((p_source IS DISTINCT FROM p_new AND f.store_id = p_source) OR (p_source = p_new AND f.store_id IS NULL))) THEN
        v_new := commerce.clone_id(p_new, v_old);
        INSERT INTO commerce.forms (id, store_id, kind, name, status, questions, words, delivery, signup, keep_months, made_from)
        SELECT v_new, p_new, f.kind, f.name, f.status, f.questions, f.words, f.delivery, f.signup, f.keep_months, f.made_from
          FROM commerce.forms f WHERE f.id = v_old
        ON CONFLICT (id) DO UPDATE
          SET name = excluded.name, status = excluded.status, questions = excluded.questions, words = excluded.words,
              delivery = excluded.delivery, signup = excluded.signup, keep_months = excluded.keep_months
          WHERE p_source = p_new;
        v_text := replace(v_text, '"' || v_old::text || '"', '"' || v_new::text || '"');
      END IF;
      v_new := NULL;
      CONTINUE;
    END IF;
    IF v_new IS NULL THEN
      v_gone := v_gone || v_old::text;
    ELSE
      v_text := replace(v_text, '"' || v_old::text || '"', '"' || v_new::text || '"');
    END IF;
    v_found := NULL;
    v_new := NULL;
  END LOOP;
  v_text := replace(v_text, '"' || p_source::text || '"', '"' || p_new::text || '"');
  IF cardinality(v_gone) > 0 THEN
    RETURN commerce.copy_prune(v_text::jsonb, v_gone);
  END IF;
  RETURN v_text::jsonb;
END;
$$;

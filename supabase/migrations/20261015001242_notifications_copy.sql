-- Customer notifications, staff alerts and automation rules (wave 3, D238, docs/wave-3-notifications.md 3.6) in the store copies.
--
-- * duplicate_store() (D129) patched in place (as shipping_methods_copy does), idempotent by a marker, raising when its anchor is gone. It copies the
--   notification switches, the staff alert settings and the automation rules:
--   - `staff_alert_settings`: the summary's choice and the contact address's events, with `configured_at` null, so the defaults hold in the copy (its
--     own owners get new orders, returns requested and low stock): the recipients are the original's people and are never copied.
--   - `order_rules`: with new ids; a `has_product` condition keeps the products that were copied, under their new ids, and a rule that lost any product
--     is switched off (and loses the condition when none of its products came), as campaigns do (D114).
-- * The owner's email texts (`email_templates`) are copied only when the owner ticks *Email texts* in the copy wizard (`StoreCopyOptions.emailTexts`):
--   `commerce.copy_email_templates(source, store)`, called by `startStoreCopy()` in the same transaction as duplicate_store(). (A separate function and not a
--   new argument of duplicate_store(): the code running until the deploy finishes calls it with the arguments it has.)
-- * clone_store() (a new store from the template or a store template) copies none of these: a template's texts are another business's words, and a new
--   store starts with the defaults.
--
-- No function here contains DELETE, TRUNCATE or DROP.

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  IF position('-- Notifications (D238)' in v_def) > 0 THEN
    RETURN;
  END IF;
  v_new := replace(v_def, E'\n  RETURN v_store;\nEND;', $block$

  -- Notifications (D238): the switches, the staff alert settings without their recipients (the defaults hold in the copy) and the automation rules, with
  -- a product condition kept to the copied products and a rule that lost one switched off.
  INSERT INTO commerce.notification_settings (store_id, notification, enabled, updated_by)
  SELECT v_store, notification, enabled, p_owner
    FROM commerce.notification_settings WHERE store_id = p_source;

  INSERT INTO commerce.staff_alert_settings (store_id, configured_at, summary, summary_weekday, summary_hour, contact_events, updated_by)
  SELECT v_store, NULL, summary, summary_weekday, summary_hour, contact_events, p_owner
    FROM commerce.staff_alert_settings WHERE store_id = p_source;

  INSERT INTO commerce.order_rules (id, store_id, name, event, match, conditions, actions, enabled, position, version, created_by, updated_by, created_at)
  SELECT commerce.clone_id(v_store, r.id), v_store, r.name, r.event, r.match, m.conditions, r.actions, r.enabled AND NOT m.lost, r.position, 1,
         p_owner, p_owner, r.created_at
    FROM commerce.order_rules r
    CROSS JOIN LATERAL (
      SELECT coalesce(jsonb_agg(c.mapped ORDER BY c.n) FILTER (WHERE c.mapped IS NOT NULL), '[]'::jsonb) AS conditions,
             coalesce(bool_or(c.lost), false) AS lost
        FROM (
          SELECT e.n,
                 CASE
                   WHEN e.value->>'kind' <> 'has_product' THEN e.value
                   WHEN jsonb_array_length(p.kept) = 0 THEN NULL
                   ELSE jsonb_set(e.value, '{productIds}', p.kept)
                 END AS mapped,
                 e.value->>'kind' = 'has_product' AND jsonb_array_length(p.kept) < jsonb_array_length(coalesce(e.value->'productIds', '[]'::jsonb)) AS lost
            FROM jsonb_array_elements(r.conditions) WITH ORDINALITY AS e(value, n)
            CROSS JOIN LATERAL (
              SELECT coalesce(jsonb_agg(to_jsonb(commerce.clone_id(v_store, pid.value::uuid)) ORDER BY pid.n), '[]'::jsonb) AS kept
                FROM jsonb_array_elements_text(CASE WHEN e.value->>'kind' = 'has_product' THEN coalesce(e.value->'productIds', '[]'::jsonb) ELSE '[]'::jsonb END)
                     WITH ORDINALITY AS pid(value, n)
               WHERE EXISTS (SELECT 1 FROM commerce.products np WHERE np.store_id = v_store AND np.id = commerce.clone_id(v_store, pid.value::uuid))
            ) p
        ) c
    ) m
   WHERE r.store_id = p_source;

  RETURN v_store;
END;$block$);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'duplicate_store: its end was not found, so notifications cannot be copied';
  END IF;
  EXECUTE v_new;
END;
$patch$;
--> statement-breakpoint

-- The owner's email texts, copied into a copy of the store only when the owner chose *Email texts*. Both stores must exist and be different; a text the
-- copy already has is kept. Returns how many were copied.
CREATE FUNCTION commerce.copy_email_templates(p_source uuid, p_store uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_source = p_store THEN
    RAISE EXCEPTION 'copy_email_templates.same_store: a store''s texts are copied into another store' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO commerce.email_templates (store_id, notification, locale, subject, heading, body, created_at)
  SELECT p_store, t.notification, t.locale, t.subject, t.heading, t.body, t.created_at
    FROM commerce.email_templates t
   WHERE t.store_id = p_source
  ON CONFLICT (store_id, notification, locale) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

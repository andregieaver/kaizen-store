-- Discount combinations (D367, docs/wave-10-must-haves.md unit D): a store's copy carries whether each campaign combines with codes
-- and each code with campaigns. `duplicate_store()` names the columns it copies, so the copied rows would otherwise take the
-- default (on); the two settings are set from the original's right after its codes' and campaigns' own remapping. Patched in place,
-- so the earlier patches of `duplicate_store()` stay as they are.
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  v_anchor constant text := E'  -- Its categories, tags and customer groups (D299) are the copy''s; one whose every one was left out is switched off.\n';
BEGIN
  IF position('combines_with_codes' in v_def) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'duplicate_store: the discount codes copy is not where it was expected';
  END IF;
  v_def := replace(v_def, v_anchor,
    E'  -- Whether a campaign combines with codes, and a code with campaigns (D367), as the original says.\n'
    || E'  UPDATE commerce.campaigns d\n'
    || E'     SET combines_with_codes = t.combines_with_codes\n'
    || E'    FROM commerce.campaigns t\n'
    || E'   WHERE t.store_id = p_source AND NOT t.combines_with_codes\n'
    || E'     AND d.store_id = v_store AND d.id = commerce.clone_id(v_store, t.id);\n'
    || E'  UPDATE commerce.discount_codes d\n'
    || E'     SET combines_with_campaigns = t.combines_with_campaigns\n'
    || E'    FROM commerce.discount_codes t\n'
    || E'   WHERE t.store_id = p_source AND NOT t.combines_with_campaigns\n'
    || E'     AND d.store_id = v_store AND d.id = commerce.clone_id(v_store, t.id);\n\n'
    || v_anchor);
  EXECUTE v_def;
END
$patch$;

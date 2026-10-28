ALTER TABLE "commerce"."campaigns" ADD COLUMN "segment_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."discount_codes" ADD COLUMN "segment_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."campaigns" ADD CONSTRAINT "campaigns_segment_fk" FOREIGN KEY ("store_id","segment_id") REFERENCES "commerce"."segments"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."discount_codes" ADD CONSTRAINT "discount_codes_segment_fk" FOREIGN KEY ("store_id","segment_id") REFERENCES "commerce"."segments"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_segment_idx" ON "commerce"."campaigns" USING btree ("store_id","segment_id");--> statement-breakpoint
CREATE INDEX "discount_codes_segment_idx" ON "commerce"."discount_codes" USING btree ("store_id","segment_id");--> statement-breakpoint
-- A code or campaign limited to a segment (D380) is copied switched off by `duplicate_store()`: segments are never copied (COPY_RULES), and a
-- copied code with its segment left out would reach everyone. Patched in place before D367's lines, so the earlier patches stay as they are.
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  v_anchor constant text := E'  -- Whether a campaign combines with codes, and a code with campaigns (D367), as the original says.\n';
BEGIN
  IF position('segment_id IS NOT NULL' in v_def) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'duplicate_store: the discount combinations copy is not where it was expected';
  END IF;
  v_def := replace(v_def, v_anchor,
    E'  -- A code or campaign limited to a segment (D380) is copied switched off: the copy has no segments.\n'
    || E'  UPDATE commerce.campaigns d\n'
    || E'     SET active = false\n'
    || E'    FROM commerce.campaigns t\n'
    || E'   WHERE t.store_id = p_source AND t.segment_id IS NOT NULL\n'
    || E'     AND d.store_id = v_store AND d.id = commerce.clone_id(v_store, t.id);\n'
    || E'  UPDATE commerce.discount_codes d\n'
    || E'     SET active = false\n'
    || E'    FROM commerce.discount_codes t\n'
    || E'   WHERE t.store_id = p_source AND t.segment_id IS NOT NULL\n'
    || E'     AND d.store_id = v_store AND d.id = commerce.clone_id(v_store, t.id);\n\n'
    || v_anchor);
  EXECUTE v_def;
END
$patch$;

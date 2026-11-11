ALTER TABLE "commerce"."return_settings" ADD COLUMN "instructions_translations" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
-- The instructions in the store's other languages go with the settings when a store is copied (D153): the two copy
-- functions name their columns, so the new one is added to the list they copy, as they are live.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.clone_store(uuid, text, text, uuid)'::regprocedure);
  IF position('instructions_translations' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, 'accept_excluded, instructions, return_address,', 'accept_excluded, instructions, instructions_translations, return_address,');
  IF v_new = v_def THEN RAISE EXCEPTION 'clone_store: its copy of the return settings was not found, so the translated instructions are not copied'; END IF;
  EXECUTE v_new;
END
$patch$;
--> statement-breakpoint
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  IF position('instructions_translations' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, 'accept_excluded, instructions, return_address,', 'accept_excluded, instructions, instructions_translations, return_address,');
  IF v_new = v_def THEN RAISE EXCEPTION 'duplicate_store: its copy of the return settings was not found, so the translated instructions are not copied'; END IF;
  EXECUTE v_new;
END
$patch$;

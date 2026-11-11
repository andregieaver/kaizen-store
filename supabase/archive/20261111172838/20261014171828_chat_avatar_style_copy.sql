-- A store's copy keeps its chat agent's picture frame (D233, `chat_agents.avatar_style`): duplicate_store() patched in place, as
-- store_features_rules does, so every change made to it since stays.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.duplicate_store(uuid, text, text, uuid, uuid[], uuid[], uuid[])'::regprocedure);
  v_new := replace(replace(v_def,
    'store_id, enabled, name, occupation, avatar, greeting, instructions, voice, daily_limit, updated_by',
    'store_id, enabled, name, occupation, avatar, avatar_style, greeting, instructions, voice, daily_limit, updated_by'),
    'SELECT v_store, enabled, name, occupation, avatar, greeting, instructions, voice, daily_limit, p_owner',
    'SELECT v_store, enabled, name, occupation, avatar, avatar_style, greeting, instructions, voice, daily_limit, p_owner');
  IF v_new = v_def OR position('occupation, avatar, avatar_style, greeting, instructions, voice, daily_limit, p_owner' in v_new) = 0
     OR position('occupation, avatar, avatar_style, greeting, instructions, voice, daily_limit, updated_by' in v_new) = 0 THEN
    RAISE EXCEPTION 'duplicate_store: the copy of the chat agent was not found';
  END IF;
  EXECUTE v_new;
END;
$patch$;

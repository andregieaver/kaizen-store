-- One running timer per person across all their stores (D123).
--
-- Work moved up to the store owner's level: someone who runs several sites has one clock, not one
-- per store. Each entry a stopped timer makes is still logged to its own store's assignment (each
-- store is the seller). The advisory lock that serialises a person's timer is now keyed on the
-- person alone, in the stop function too (a lock is re-entered by the same transaction, so a start
-- that stops the earlier clock still holds one lock). `commerce.work_timers` keeps its primary key
-- (store, person); the rule "one per person" is the unique index on the person below.

CREATE OR REPLACE FUNCTION commerce.work_stop_timer(p_store uuid, p_account uuid, p_note text DEFAULT NULL)
RETURNS SETOF commerce.work_time_entries
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_timer commerce.work_timers;
  v_entry commerce.work_time_entries;
  v_zone text;
  v_minutes integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('work_timer:' || p_account::text, 0));
  DELETE FROM commerce.work_timers WHERE store_id = p_store AND account_id = p_account RETURNING * INTO v_timer;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT s.time_zone INTO v_zone FROM commerce.stores s WHERE s.id = p_store;
  v_minutes := least(1440, greatest(1, ceil(extract(epoch FROM (now() - v_timer.started_at)) / 60)::integer));
  INSERT INTO commerce.work_time_entries (store_id, assignment_id, task_id, account_id, work_date, minutes, billable, note)
  VALUES (p_store, v_timer.assignment_id, v_timer.task_id, p_account,
          (v_timer.started_at AT TIME ZONE v_zone)::date, v_minutes, true, nullif(trim(p_note), ''))
  RETURNING * INTO v_entry;
  PERFORM commerce.work_event(
    p_store, 'time', v_entry.id, 'time.logged',
    jsonb_build_object('minutes', v_entry.minutes, 'assignment_id', v_entry.assignment_id,
                       'task_id', v_entry.task_id, 'source', 'timer'),
    p_account);
  RETURN NEXT v_entry;
END;
$$;
--> statement-breakpoint

-- Starts a timer for the person on an assignment (and task of it) of p_store. One runs per person
-- in ALL stores: a running one, in any store, is stopped and logged first (to its own store), in
-- the same transaction. Returns when the new one started and the entry the earlier one became
-- (null if none was running); that entry's store is found by its id.
CREATE OR REPLACE FUNCTION commerce.work_start_timer(p_store uuid, p_account uuid, p_assignment uuid, p_task uuid DEFAULT NULL)
RETURNS TABLE (timer_started_at timestamptz, stopped_entry_id uuid)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_stopped uuid;
  v_one uuid;
  v_store uuid;
  v_started timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('work_timer:' || p_account::text, 0));
  FOR v_store IN SELECT w.store_id FROM commerce.work_timers w WHERE w.account_id = p_account ORDER BY w.started_at LOOP
    SELECT e.id INTO v_one FROM commerce.work_stop_timer(v_store, p_account, NULL) e;
    v_stopped := coalesce(v_one, v_stopped);
  END LOOP;
  INSERT INTO commerce.work_timers (store_id, account_id, assignment_id, task_id)
  VALUES (p_store, p_account, p_assignment, p_task)
  RETURNING started_at INTO v_started;
  RETURN QUERY SELECT v_started, v_stopped;
END;
$$;
--> statement-breakpoint

-- Timers running in several stores at once (from before this change): the newest keeps running, the
-- others are stopped and logged to their own stores, so the unique index below can be made.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT t.store_id, t.account_id
    FROM (SELECT w.store_id, w.account_id,
                 row_number() OVER (PARTITION BY w.account_id ORDER BY w.started_at DESC, w.store_id) AS n
          FROM commerce.work_timers w) t
    WHERE t.n > 1
  LOOP
    PERFORM commerce.work_stop_timer(r.store_id, r.account_id, NULL);
  END LOOP;
END;
$$;
--> statement-breakpoint
DROP INDEX "commerce"."work_timers_account_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "work_timers_account_idx" ON "commerce"."work_timers" USING btree ("account_id");

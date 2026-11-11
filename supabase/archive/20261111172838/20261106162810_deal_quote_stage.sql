-- A deal moves into its pipeline's quote stage when its quote is sent (S2 of docs/own-books-and-sales.md, D464, left for later there):
--   when a quote draft linked to an open deal is sent (draft_orders.sent_at set), or a sent quote is linked to one, the deal moves forward
--   to its pipeline's quote stage, never back: a deal already there or further on stays where it is. The move is kept as every move is
--   (deals_history), with `via` 'quote' so the deal's history says what moved it.

CREATE OR REPLACE FUNCTION commerce.deals_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO commerce.deal_moves (store_id, deal_id, stage_id, status, via, moved_by)
    VALUES (NEW.store_id, NEW.id, NEW.stage_id, NEW.status,
      coalesce(NEW.closed_via, nullif(current_setting('commerce.deal_move_via', true), '')), NEW.updated_by);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.deal_quote_sent(p_store uuid, p_draft uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  d record;
  v_moved integer := 0;
BEGIN
  FOR d IN
    SELECT dd.id AS deal_id, q.id AS quote_stage
      FROM commerce.deal_links dl
      JOIN commerce.deals dd ON dd.store_id = dl.store_id AND dd.id = dl.deal_id
      JOIN commerce.deal_stages q ON q.store_id = dd.store_id AND q.pipeline_id = dd.pipeline_id AND q.quote_stage
      JOIN commerce.deal_stages cur ON cur.store_id = dd.store_id AND cur.id = dd.stage_id
     WHERE dl.store_id = p_store AND dl.kind = 'draft' AND dl.draft_id = p_draft AND dd.status = 'open' AND cur.position < q.position
  LOOP
    PERFORM set_config('commerce.deal_move_via', 'quote', true);
    UPDATE commerce.deals SET stage_id = d.quote_stage, updated_by = NULL, updated_at = now() WHERE store_id = p_store AND id = d.deal_id;
    PERFORM set_config('commerce.deal_move_via', '', true);
    v_moved := v_moved + 1;
  END LOOP;
  RETURN v_moved;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.draft_orders_quote_sent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  PERFORM commerce.deal_quote_sent(NEW.store_id, NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS draft_orders_quote_sent ON commerce.draft_orders;
--> statement-breakpoint
CREATE TRIGGER draft_orders_quote_sent
  AFTER UPDATE OF sent_at ON commerce.draft_orders
  FOR EACH ROW WHEN (OLD.sent_at IS NULL AND NEW.sent_at IS NOT NULL)
  EXECUTE FUNCTION commerce.draft_orders_quote_sent();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION commerce.deal_links_quote_sent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM commerce.draft_orders o WHERE o.store_id = NEW.store_id AND o.id = NEW.draft_id AND o.sent_at IS NOT NULL) THEN
    PERFORM commerce.deal_quote_sent(NEW.store_id, NEW.draft_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS deal_links_quote_sent ON commerce.deal_links;
--> statement-breakpoint
CREATE TRIGGER deal_links_quote_sent
  AFTER INSERT ON commerce.deal_links
  FOR EACH ROW WHEN (NEW.kind = 'draft')
  EXECUTE FUNCTION commerce.deal_links_quote_sent();

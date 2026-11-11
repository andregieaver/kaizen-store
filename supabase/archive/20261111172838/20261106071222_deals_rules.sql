-- Deals and pipelines (S2 of docs/own-books-and-sales.md, D464): the rules the database keeps.
--   Row-level security on every table, as every commerce table.
--   A deal's person and company are links that erasure and deletion set null (the composite key would otherwise null the store id too).
--   `deals_stage_clock()` restarts a deal's clock when its stage changes; `deals_history()` keeps each stage entered and each close or reopen.
--   `deal_win()` wins the open deals given; an order that becomes paid, an issued Work invoice, or a link made to something already paid or
--   invoiced wins the deals linked to it. A lost or won deal is never won again by a trigger, and an order copied from another store never wins.
--   A deal's custom fields go with it.

ALTER TABLE "commerce"."deal_pipelines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."deal_stages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."deals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."deal_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."deal_moves" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE commerce.deals DROP CONSTRAINT deals_customer_fk;
--> statement-breakpoint
ALTER TABLE commerce.deals ADD CONSTRAINT deals_customer_fk
  FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers (store_id, id)
  ON DELETE SET NULL (customer_id);
--> statement-breakpoint
ALTER TABLE commerce.deals DROP CONSTRAINT deals_company_fk;
--> statement-breakpoint
ALTER TABLE commerce.deals ADD CONSTRAINT deals_company_fk
  FOREIGN KEY (store_id, company_id) REFERENCES commerce.customer_companies (store_id, id)
  ON DELETE SET NULL (company_id);
--> statement-breakpoint

CREATE FUNCTION commerce.deals_stage_clock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    NEW.stage_entered_at := now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER deals_stage_clock BEFORE UPDATE OF stage_id ON commerce.deals
  FOR EACH ROW EXECUTE FUNCTION commerce.deals_stage_clock();
--> statement-breakpoint

CREATE FUNCTION commerce.deals_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO commerce.deal_moves (store_id, deal_id, stage_id, status, via, moved_by)
    VALUES (NEW.store_id, NEW.id, NEW.stage_id, NEW.status, NEW.closed_via, NEW.updated_by);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER deals_history AFTER INSERT OR UPDATE OF stage_id, status ON commerce.deals
  FOR EACH ROW EXECUTE FUNCTION commerce.deals_history();
--> statement-breakpoint

-- Wins the open deals among these, by what won them; a closed deal is left as it is. The one writer of a win that is not a person's.
CREATE FUNCTION commerce.deal_win(p_store uuid, p_deals uuid[], p_via text)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  n integer;
BEGIN
  IF p_deals IS NULL OR cardinality(p_deals) = 0 THEN
    RETURN 0;
  END IF;
  UPDATE commerce.deals
     SET status = 'won', closed_at = now(), closed_via = p_via, close_reason = NULL, updated_by = NULL, updated_at = now()
   WHERE store_id = p_store AND id = ANY (p_deals) AND status = 'open';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
--> statement-breakpoint

-- An order that becomes paid wins the deals linked to it or to the draft it was made from; a copied order is another store's history.
CREATE FUNCTION commerce.orders_deal_win()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.copied_from IS NOT NULL THEN
    RETURN NULL;
  END IF;
  PERFORM commerce.deal_win(
    NEW.store_id,
    ARRAY(
      SELECT l.deal_id FROM commerce.deal_links l
       WHERE l.store_id = NEW.store_id AND (l.order_id = NEW.id OR (NEW.draft_id IS NOT NULL AND l.draft_id = NEW.draft_id))
    ),
    'order'
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_deal_win AFTER UPDATE OF status ON commerce.orders
  FOR EACH ROW
  WHEN (OLD.status NOT IN ('paid', 'fulfilled', 'closed') AND NEW.status IN ('paid', 'fulfilled'))
  EXECUTE FUNCTION commerce.orders_deal_win();
--> statement-breakpoint

-- A Work invoice issued for an assignment wins the deals linked to the assignment (an imported invoice is inserted issued and wins nothing).
CREATE FUNCTION commerce.work_invoices_deal_win()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM commerce.deal_win(
    NEW.store_id,
    ARRAY(SELECT l.deal_id FROM commerce.deal_links l WHERE l.store_id = NEW.store_id AND l.assignment_id = NEW.assignment_id),
    'work_invoice'
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_invoices_deal_win AFTER UPDATE OF status ON commerce.work_invoices
  FOR EACH ROW
  WHEN (OLD.status = 'draft' AND NEW.status <> 'draft' AND NEW.assignment_id IS NOT NULL AND NOT NEW.imported)
  EXECUTE FUNCTION commerce.work_invoices_deal_win();
--> statement-breakpoint

-- A link made to something already paid or invoiced wins its deal at once.
CREATE FUNCTION commerce.deal_links_win()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (NEW.kind = 'order' AND EXISTS (
        SELECT 1 FROM commerce.orders o
         WHERE o.store_id = NEW.store_id AND o.id = NEW.order_id AND o.copied_from IS NULL AND o.status IN ('paid', 'fulfilled', 'closed')))
     OR (NEW.kind = 'draft' AND EXISTS (
        SELECT 1 FROM commerce.orders o
         WHERE o.store_id = NEW.store_id AND o.draft_id = NEW.draft_id AND o.copied_from IS NULL AND o.status IN ('paid', 'fulfilled', 'closed'))) THEN
    PERFORM commerce.deal_win(NEW.store_id, ARRAY[NEW.deal_id], 'order');
  ELSIF NEW.kind = 'work_assignment' AND EXISTS (
        SELECT 1 FROM commerce.work_invoices w
         WHERE w.store_id = NEW.store_id AND w.assignment_id = NEW.assignment_id AND w.status <> 'draft' AND NOT w.imported) THEN
    PERFORM commerce.deal_win(NEW.store_id, ARRAY[NEW.deal_id], 'work_invoice');
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER deal_links_win AFTER INSERT ON commerce.deal_links
  FOR EACH ROW EXECUTE FUNCTION commerce.deal_links_win();
--> statement-breakpoint

CREATE TRIGGER deals_forget_field_values AFTER DELETE ON commerce.deals
  FOR EACH ROW EXECUTE FUNCTION commerce.forget_field_values('deal');

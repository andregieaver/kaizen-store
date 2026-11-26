-- Where a checklist task came from (D904, docs/projects.md P8.3a): an order, a return, a review or a support conversation of the task's own
-- store, at most one (checklist_items_one_source). Each link is cleared when what it points at goes, and the task stays. The rules are held
-- here, so the AI manager and the API get them as the screens do.

ALTER TABLE commerce.checklist_items ADD CONSTRAINT checklist_items_order_fk
  FOREIGN KEY (store_id, order_id) REFERENCES commerce.orders (store_id, id)
  ON DELETE SET NULL (order_id);
--> statement-breakpoint
ALTER TABLE commerce.checklist_items ADD CONSTRAINT checklist_items_return_fk
  FOREIGN KEY (store_id, return_id) REFERENCES commerce.returns (store_id, id)
  ON DELETE SET NULL (return_id);
--> statement-breakpoint
ALTER TABLE commerce.checklist_items ADD CONSTRAINT checklist_items_review_fk
  FOREIGN KEY (store_id, review_id) REFERENCES commerce.product_reviews (store_id, id)
  ON DELETE SET NULL (review_id);
--> statement-breakpoint
-- A conversation has no (store_id, id) key (the platform's own have no store), so its key is the id and its store is checked below.
ALTER TABLE commerce.checklist_items ADD CONSTRAINT checklist_items_conversation_fk
  FOREIGN KEY (conversation_id) REFERENCES commerce.support_conversations (id)
  ON DELETE SET NULL;
--> statement-breakpoint

CREATE FUNCTION commerce.checklist_items_conversation_store()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.support_conversations c WHERE c.id = NEW.conversation_id AND c.store_id = NEW.store_id
  ) THEN
    RAISE EXCEPTION 'checklist_item.conversation_store: the conversation is not the store''s' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.checklist_items_conversation_store() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER checklist_items_conversation_store BEFORE INSERT OR UPDATE OF conversation_id, store_id ON commerce.checklist_items
  FOR EACH ROW EXECUTE FUNCTION commerce.checklist_items_conversation_store();

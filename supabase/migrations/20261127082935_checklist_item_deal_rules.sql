-- The deal a checklist task is a next step of (D910, docs/projects.md P6.2): the task's own store's deal, by the composite key, so another
-- store's cannot be named. Cleared when the deal is deleted; the task stays. The column is new and empty, so the check of existing rows
-- reads nothing.

ALTER TABLE commerce.checklist_items ADD CONSTRAINT checklist_items_deal_fk
  FOREIGN KEY (store_id, deal_id) REFERENCES commerce.deals (store_id, id)
  ON DELETE SET NULL (deal_id);

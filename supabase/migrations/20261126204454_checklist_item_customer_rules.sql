-- The customer a checklist task is about (D903, docs/projects.md P4.7, Life's contact on an item): the task's own store's customer, by the
-- composite key, so another store's cannot be named. Cleared when the customer is deleted (merged into another, or erased); the task stays.
-- The column is new and empty, so the check of existing rows reads nothing.

ALTER TABLE commerce.checklist_items ADD CONSTRAINT checklist_items_customer_fk
  FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers (store_id, id)
  ON DELETE SET NULL (customer_id);

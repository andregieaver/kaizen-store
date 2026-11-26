-- A project started from a deal (D904, docs/projects.md P8.3b): the deal is the store's own, and the link is cleared when the deal is
-- deleted while the project stays. Projects holds the link, so Deals' own tables know nothing of Projects.
ALTER TABLE commerce.projects ADD CONSTRAINT projects_deal_fk
  FOREIGN KEY (store_id, deal_id) REFERENCES commerce.deals (store_id, id)
  ON DELETE SET NULL (deal_id);

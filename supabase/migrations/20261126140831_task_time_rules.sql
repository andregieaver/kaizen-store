-- A list's time goes to a Work assignment (D904, docs/projects.md P8.3d): the store's own assignment, the link cleared when the
-- assignment is deleted while the list stays. Projects holds the link, so Work's own tables know nothing of Projects.
ALTER TABLE commerce.checklists ADD CONSTRAINT checklists_assignment_fk
  FOREIGN KEY (store_id, assignment_id) REFERENCES commerce.work_assignments (store_id, id)
  ON DELETE SET NULL (assignment_id);

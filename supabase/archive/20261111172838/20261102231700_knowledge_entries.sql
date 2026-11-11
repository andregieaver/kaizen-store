-- The chat agent's knowledge (D81, D428): a content type's published entries (D326) are passages too, beside pages, articles and
-- documents. Each passage still comes from exactly one source; an entry's go with it when it is deleted.
ALTER TABLE commerce.knowledge_chunks ADD COLUMN entry_id uuid REFERENCES commerce.content_entries (id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE commerce.knowledge_chunks DROP CONSTRAINT knowledge_chunks_source;
--> statement-breakpoint
ALTER TABLE commerce.knowledge_chunks ADD CONSTRAINT knowledge_chunks_source CHECK (num_nonnulls(document_id, page_id, entry_id) = 1);
--> statement-breakpoint
CREATE INDEX knowledge_chunks_entry_idx ON commerce.knowledge_chunks (entry_id, locale);

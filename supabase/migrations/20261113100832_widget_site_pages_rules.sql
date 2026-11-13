-- The pages of chat widgets' websites (D583): a private table, as every table of the commerce schema, reached only by the server.
alter table commerce.support_widget_site_pages enable row level security;
--> statement-breakpoint
-- Their passages are the knowledge base's own rows, with the page they came from: deleting a page, its site or its widget takes them.
alter table commerce.knowledge_chunks add column site_page_id uuid references commerce.support_widget_site_pages(id) on delete cascade;
--> statement-breakpoint
create index knowledge_chunks_site_page_idx on commerce.knowledge_chunks (site_page_id);
--> statement-breakpoint
-- A passage comes from one source: a document, a page or an entry of the site, or now a page of a widget's website. Every row has one of
-- the first three, so the wider rule holds for them as it stands.
alter table commerce.knowledge_chunks drop constraint knowledge_chunks_source;
--> statement-breakpoint
alter table commerce.knowledge_chunks add constraint knowledge_chunks_source check (num_nonnulls(document_id, page_id, entry_id, site_page_id) = 1);

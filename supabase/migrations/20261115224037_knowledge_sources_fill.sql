-- A row for each page, article and entry whose passages are current today (bloat review step 0.27), so the first run after the deploy
-- cuts nothing again and no vector is thrown away. A source whose passages are older than its publishing gets no row and is cut once.
insert into commerce.knowledge_sources (store_id, page_id, published_at, slug, path)
select p.store_id, p.id, p.published_at, p.slug, c.path
from commerce.pages p
join (select page_id, min(version) as version, min(path) as path from commerce.knowledge_chunks where page_id is not null group by page_id) c on c.page_id = p.id
where p.published_at is not null and p.type in ('page', 'article')
  and c.version = to_char(p.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
on conflict do nothing;
--> statement-breakpoint
insert into commerce.knowledge_sources (store_id, entry_id, published_at, slug, type_version, path)
select e.store_id, e.id, e.published_at, e.slug, md5(t.fields::text || t.title_field || t.slug || t.has_pages::text), c.path
from commerce.content_entries e
join commerce.content_types t on t.id = e.type_id
join (select entry_id, min(version) as version, min(path) as path from commerce.knowledge_chunks where entry_id is not null group by entry_id) c on c.entry_id = e.id
where e.published_at is not null
  and c.version = to_char(e.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' || md5(t.fields::text || t.title_field || t.slug || t.has_pages::text)
on conflict do nothing;

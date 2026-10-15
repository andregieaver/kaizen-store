-- The platform is renamed Kaizena Flow (D240, docs/theme-store.md 8). This changes only words in the data the platform keeps for itself and for new stores
-- to copy: the template store and the platform's hidden stores (store templates' copies, design profiles' workspaces), the "Made with Kaizen" link the
-- template put in footer menus (with its old address), and the plan comparison's texts. Kaizen Life keeps its name. Kaizena Flow's own pages are edited by
-- the platform's admins and are not touched here, nor are retention rules (written only through set_retention_rule(), compared with RETENTION_SEED).

UPDATE commerce.stores SET name = 'Kaizena Flow Demo' WHERE name = 'Kaizen Demo' AND (is_template OR starter);

UPDATE commerce.menus
SET items = regexp_replace(
  replace(replace(items::text, 'https://kaizenstore.cloud', 'https://kaizenaflow.com'), 'https://kaizenalabs.com', 'https://kaizenaflow.com'),
  '(Laget med|Byggd med|Lavet med|Made with) Kaizen(?! Life)(?!a)', '\1 Kaizena Flow', 'g')::jsonb
WHERE items::text ~ 'kaizenstore\.cloud|kaizenalabs\.com|(Laget med|Byggd med|Lavet med|Made with) Kaizen(?! Life)(?!a)';

UPDATE commerce.pages
SET published = CASE WHEN published IS NULL THEN NULL ELSE
      regexp_replace(regexp_replace(replace(published::text, 'kaizenstore.cloud', 'kaizenaflow.com'), '\mKaizens\M', 'Kaizena Flows', 'g'), '\mKaizen\M(?! Life)(?!a)', 'Kaizena Flow', 'g')::jsonb END,
    draft = CASE WHEN draft IS NULL THEN NULL ELSE
      regexp_replace(regexp_replace(replace(draft::text, 'kaizenstore.cloud', 'kaizenaflow.com'), '\mKaizens\M', 'Kaizena Flows', 'g'), '\mKaizen\M(?! Life)(?!a)', 'Kaizena Flow', 'g')::jsonb END
WHERE store_id IN (SELECT id FROM commerce.stores WHERE is_template OR starter)
  AND (coalesce(published::text, '') || coalesce(draft::text, '')) ~ '\mKaizens?\M(?! Life)(?!a)|kaizenstore\.cloud';

UPDATE commerce.plan_features
SET name = regexp_replace(name, '\mKaizen\M(?! Life)(?!a)', 'Kaizena Flow', 'g'),
    description = regexp_replace(description, '\mKaizen\M(?! Life)(?!a)', 'Kaizena Flow', 'g')
WHERE coalesce(name, '') || coalesce(description, '') ~ '\mKaizen\M(?! Life)(?!a)';

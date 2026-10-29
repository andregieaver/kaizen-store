-- The owner's decision of 29 October 2026 (D405, wave 11's decision 4): a store's theme install that followed its theme's updates by itself
-- from before D344 is switched to having them offered (What's new and the owner's Update), as every install made since is. An install whose
-- owner switched following on themselves (the audit entry `store.theme_follows_updates` with follows true) keeps following. Kaizena Flow's
-- own site's installs (platform_theme_installs) are not stores' and are left as they are.
UPDATE commerce.store_theme_installs i
SET follows_updates = false
WHERE i.follows_updates
  AND NOT EXISTS (
    SELECT 1 FROM commerce.audit_log a
    WHERE a.store_id = i.store_id
      AND a.action = 'store.theme_follows_updates'
      AND a.details ->> 'install' = i.id::text
      AND (a.details ->> 'follows')::boolean
  );

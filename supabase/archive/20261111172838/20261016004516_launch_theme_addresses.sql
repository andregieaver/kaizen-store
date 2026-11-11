-- Launch themes published before the theme store (D247) have no address, so the store lists none of them: `markLaunchTheme()` gives a
-- launch theme its key as its address, but only when the themes are synced again, which nobody had done. Each gets its key now, as the sync
-- would, unless another theme already has that address. Data only: no rule changes.
UPDATE commerce.design_presets p SET slug = p.launch_key
WHERE p.slug IS NULL AND p.launch_key IS NOT NULL
  AND p.launch_key ~ '^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$'
  AND NOT EXISTS (SELECT 1 FROM commerce.design_presets o WHERE o.slug = p.launch_key);

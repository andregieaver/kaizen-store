-- D312: Kaizena Flow's own site goes live in Norwegian at once, with no review first (the owner, 2026-10-22). English stays first.
update commerce.platform_settings
  set locales = array['en-GB', 'nb-NO']::text[]
  where not ('nb-NO' = any (locales));

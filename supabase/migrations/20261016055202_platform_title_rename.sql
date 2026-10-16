-- Kaizena Flow's SEO title (D240): the site's title, set on Platform -> SEO before the rename, still read "Kaizen Store - AI-powered Stores
-- for Startups", so every page of Kaizena Flow's site and the theme store carried the old name in its title and share cards. The name is
-- changed and the tagline kept, only while the title is still exactly the old text, so a title saved since stays. Data only: no rule changes.
UPDATE commerce.platform_settings
SET seo = jsonb_set(seo, '{title,en}', to_jsonb('Kaizena Flow - AI-powered Stores for Startups'::text))
WHERE seo -> 'title' ->> 'en' = 'Kaizen Store - AI-powered Stores for Startups';

-- The plan comparison (D132) learns what wave 2's second run added (D168): redirects with a 404 report, and SEO texts for categories and tags. The rows
-- describe; they enable nothing, and no plan includes them until the platform's admin ticks the plans that do. The limit named here is the same for every
-- store today (src/lib/data-limits.ts: REDIRECTS_MAX). Positions follow the category's last row (85).
INSERT INTO commerce.plan_features (category, name, description, position)
SELECT v.category, v.name, v.description, v.position
  FROM (VALUES
    ('Storefront and catalogue', 'Redirects and 404 report', 'Redirects are made when a product, category or tag changes address, and added by hand or imported from a CSV file; a report of the addresses shoppers and search engines could not find, with a one-click redirect; up to 100,000 manual redirects.', 90),
    ('Storefront and catalogue', 'SEO title and description for categories and tags', 'Search-result title and description for every category and tag in every language of the store.', 95)
  ) AS v(category, name, description, position)
 WHERE NOT EXISTS (SELECT 1 FROM commerce.plan_features f WHERE f.name = v.name);

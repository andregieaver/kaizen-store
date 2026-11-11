-- The plan comparison (D132) learns what wave 2's first run added (D165): data in and out. The rows describe; they enable nothing, and no plan includes
-- them until the platform's admin ticks the plans that do. The limits named here are the same for every store today (src/lib/data-limits.ts).
INSERT INTO commerce.plan_features (category, name, description, position)
SELECT v.category, v.name, v.description, v.position
  FROM (VALUES
    ('Data', 'Product CSV import and export', 'Export every product and variant as a CSV file and import Kaizen''s own file or a Shopify product file: a check that lists every row''s problem before anything is written, then a resumable import. Never deletes a product or changes a web address. Up to 5,000 products and 15 MB a file.', 501),
    ('Data', 'Order and customer CSV export', 'The owner downloads orders (one row for each line, VAT split out, in the order''s currency and the store''s) and customers as CSV files for bookkeeping. Large files are made in the background and downloaded from the admin, never emailed, and deleted after 7 days.', 502),
    ('Data', 'Bulk product editing', 'Tick products in the list to set status, archive, change categories and tags, change prices by a percentage or an amount, or set stock, or edit price, SKU, stock and cost in a grid. Every change is shown first, written in one confirmed step and can be undone for 7 days.', 503),
    ('Data', 'CSV for every analytics table', 'Download any table or chart on the analytics pages as a CSV file for the period and comparison on the page, in the store''s main currency without VAT.', 504)
  ) AS v(category, name, description, position)
 WHERE NOT EXISTS (SELECT 1 FROM commerce.plan_features f WHERE f.name = v.name);

-- The plan comparison (D132) learns what wave 3's first run added (D172): an inventory page with locations, the history of every stock change, selling on
-- backorder with a stated delivery time, stock files with a dry run, and warnings when stock is low. The row describes; it enables nothing, and no plan
-- includes it until the platform's admin ticks the plans that do. It says only what is built (the history is kept 24 months, as the code keeps it:
-- INVENTORY_RETENTION_MONTHS). Position 401 puts it right after "Stock in several locations" (400), which it widens and does not replace.
INSERT INTO commerce.plan_features (category, name, description, position)
SELECT v.category, v.name, v.description, v.position
  FROM (VALUES
    ('Operations', 'Inventory page, stock history, backorders and low-stock warnings', 'On hand, committed and available per variant and location, with ranked locations; every change kept 24 months with its reason; selling on backorder with a stated delivery time; counted stock by CSV file; a warning level per variant.', 401)
  ) AS v(category, name, description, position)
 WHERE NOT EXISTS (SELECT 1 FROM commerce.plan_features f WHERE f.name = v.name);

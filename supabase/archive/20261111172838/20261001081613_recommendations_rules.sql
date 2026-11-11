-- Product recommendations (D139): private tables, read and written only by server code with a direct connection.
ALTER TABLE commerce.recommendation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce.recommendation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce.recommendation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce.recommendation_adds ENABLE ROW LEVEL SECURITY;

-- The plan comparison (D132): the feature is listed, in no plan yet; the platform's admin ticks the plans that include it.
INSERT INTO commerce.plan_features (category, name, description, position)
SELECT 'AI', 'Product recommendations', 'Upsells, cross-sells and complements picked for each shopper on product pages, articles and lists, with the AI re-ranking the best.', 385
WHERE NOT EXISTS (SELECT 1 FROM commerce.plan_features WHERE name = 'Product recommendations');

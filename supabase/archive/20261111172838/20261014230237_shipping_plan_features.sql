-- The plan comparison (D132) learns what wave 3's shipping methods run added (D237, docs/wave-3-shipping-methods.md 2.6): methods with rates by weight or basket
-- value per zone and profile, pickup at the store's own places, and local delivery by the store's own drivers. Each row describes; it enables nothing. As
-- D172's and D174's rows, they are in no plan until the platform's admin ticks the plans that do (the spec's "granted to every plan" is not followed: a
-- migration that ticks plans would decide for the platform's admin, which no earlier wave did). There is no category "Orders and shipping": they go in
-- Operations, after the inventory rows (400, 401) and before Customer accounts (410). They say only what is built (the limits are the code's own,
-- src/lib/shipping-limits.ts). Idempotent by name.
INSERT INTO commerce.plan_features (category, name, description, position)
SELECT v.category, v.name, v.description, v.position
  FROM (VALUES
    ('Operations', 'Shipping methods, zones and profiles', 'Named shipping methods per country, priced flat, by weight or by basket value in tiers, per zone of postal codes and per profile of products; a mixed basket pays the sum. Free above a basket value. The flat rate stays as the fallback.', 402),
    ('Operations', 'Local pickup', 'Customers collect at the store''s own shops and pickup places, free or at a price, with a usual ready time and instructions. Ready for pickup emails the customer once; Collected completes the order.', 403),
    ('Operations', 'Local delivery', 'Delivery by the store''s own drivers to areas of postal codes or within a radius of a place (up to 160 km, measured between postal-code centres), with a price, a minimum basket and free delivery above a value.', 404)
  ) AS v(category, name, description, position)
 WHERE NOT EXISTS (SELECT 1 FROM commerce.plan_features f WHERE f.name = v.name);

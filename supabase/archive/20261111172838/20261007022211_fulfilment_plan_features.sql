-- The plan comparison (D132) learns what wave 3's third run added (D174, docs/wave-3-fulfilment.md 5.5): editing a paid order before anything is sent, sending an
-- order in parcels, and pick lists. Each row describes; it enables nothing, and no plan includes it until the platform's admin ticks the plans that do. They say
-- only what is built (the limits are the code's own, src/lib/fulfilment-limits.ts: a change's pay link is valid 7 days, a pick list takes 100 orders). Positions
-- 395 to 397 put them after D173's rows (391 to 394) and before the next row of Operations (400). Idempotent by name.
INSERT INTO commerce.plan_features (category, name, description, position)
SELECT v.category, v.name, v.description, v.position
  FROM (VALUES
    ('Operations', 'Order editing after purchase', 'Staff add, remove or reduce items on a paid order before anything is sent; kept items keep their price and discounts. A lower total is refunded at once; a higher one applies when the customer pays it through a pay link valid 7 days. With invoicing on, a credit note and an additional invoice.', 395),
    ('Operations', 'Partial fulfilment', 'Send an order in several parcels: choose the items and quantities of each, with its own carrier, tracking number and email to the customer. The order shows Partly sent until everything not withdrawn is sent, and the customer''s order page lists each parcel.', 396),
    ('Operations', 'Pick lists', 'A printable list of what to take off the shelves for up to 100 orders, by product and SKU or order by order, counting only what is still to send. Packing slips for one parcel or for what is left. No prices, names or addresses.', 397)
  ) AS v(category, name, description, position)
 WHERE NOT EXISTS (SELECT 1 FROM commerce.plan_features f WHERE f.name = v.name);

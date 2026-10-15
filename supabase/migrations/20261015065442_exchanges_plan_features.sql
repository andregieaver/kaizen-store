-- The plan comparison (D132) learns what wave 3's exchanges and return labels run added (D239, docs/wave-3-exchanges.md 3.8 item 3 and 5.5): exchanges
-- on a return and return labels booked with the store's carrier. Each row describes; it enables nothing. As D172's to D238's rows, they are in no plan
-- until the platform's admin ticks the plans that do. The spec named the category Orders; the order rows live in Operations (390 to 397), so these sit
-- there, after Pick lists (398, 399). They say only what is built: labels from Posten / Bring in Norway, the one carrier with return labels. Idempotent by name.
INSERT INTO commerce.plan_features (category, name, description, position)
SELECT v.category, v.name, v.description, v.position
  FROM (VALUES
    ('Operations', 'Exchanges', 'Offer replacement goods on a return: the difference is worked out as at checkout, the customer confirms the exchange on a page you email them, and it becomes a new order paid by the return''s credit, with any rest refunded or paid by a link.', 398),
    ('Operations', 'Return labels from your carrier', 'Book a return label with Posten / Bring for a return in Norway, by hand or automatically for withdrawals. The customer prints it from the email or the return''s page; when the customer pays return shipping, the label''s cost is taken off the refund, never more than it cost.', 399)
  ) AS v(category, name, description, position)
 WHERE NOT EXISTS (SELECT 1 FROM commerce.plan_features f WHERE f.name = v.name);

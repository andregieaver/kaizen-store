-- The plan comparison (D132) learns what wave 3's second run added (D173): searching, filtering and keeping views of the order list with bulk actions, staff tags
-- and archiving, draft orders sent as a pay link or taken as paid outside Kaizen, and gift messages. Each row describes; it enables nothing, and no plan includes
-- it until the platform's admin ticks the plans that do. They say only what is built (the limits are the code's own, src/lib/order-limits.ts: 250 tags of 40
-- characters, 250 orders in a bulk action, 30 saved views, a pay link valid 1 to 30 days, a gift message of 300 characters). Positions 391 to 394 put them right
-- after "Orders, returns and refunds" (390), which they widen and do not replace. Idempotent by name.
INSERT INTO commerce.plan_features (category, name, description, position)
SELECT v.category, v.name, v.description, v.position
  FROM (VALUES
    ('Operations', 'Order search, filters, saved views and bulk actions', 'Search orders by number, customer, product, tag or tracking number; filter by payment, fulfilment, date and market; 30 saved views per store; tag, archive or mark as sent up to 250 orders at once; print packing slips.', 391),
    ('Operations', 'Order tags and archive', 'Staff-only tags on orders (up to 250 of 40 characters each) and archiving that hides finished orders from the list and queues without deleting anything; optional automatic archiving after a number of days.', 392),
    ('Operations', 'Draft orders and payment links', 'Write an order for a customer and email a pay link valid 1 to 30 days that opens on your store''s own page; custom items and prices, a staff discount, or record a payment taken outside Kaizen. Goods are held from the send.', 393),
    ('Operations', 'Gift messages', 'Shoppers can mark an order as a gift and write a name, a sender and a message of up to 300 characters. It is shown on a price-free packing slip and never sent to anyone but the buyer. Off until you switch it on.', 394)
  ) AS v(category, name, description, position)
 WHERE NOT EXISTS (SELECT 1 FROM commerce.plan_features f WHERE f.name = v.name);

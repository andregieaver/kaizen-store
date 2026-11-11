-- The plan comparison (D132) learns what wave 3's notifications run added (D238, docs/wave-3-notifications.md 2.9): editable customer emails, tracking on
-- the order page and emails from carrier events, staff alerts and summaries, and automation rules. Each row describes; it enables nothing. As D172's,
-- D174's and D237's rows, they are in no plan until the platform's admin ticks the plans that do: the spec's "granted to every plan" is not followed
-- (a migration that ticks plans would decide for the platform's admin, which no earlier wave did; spec 3.7 As built). Next to "Emails to customers"
-- (420) in Operations. They say only what is built; the carriers named are those whose events Kaizen reads. Idempotent by name.
INSERT INTO commerce.plan_features (category, name, description, position)
SELECT v.category, v.name, v.description, v.position
  FROM (VALUES
    ('Operations', 'Editable customer emails', 'Your own subject, heading and text for each order and return email in each of your languages, with placeholders, a preview and a test email. Lines, totals, VAT and the right of withdrawal are always added. Required emails, such as the order confirmation, are always sent.', 421),
    ('Operations', 'Delivery tracking on the order page', 'The carrier''s events for each parcel on the customer''s order page, followed every few minutes for parcels of carriers you connect.', 422),
    ('Operations', 'Delivery emails from carrier events', 'Out for delivery and Delivered emails from Posten / Bring''s events, once per parcel, when you switch them on. A delivery Bring reports records when the customer received the goods.', 423),
    ('Operations', 'Staff order alerts and summaries', 'An email to the staff you choose for each new order and return, overdue refunds and low stock, and a daily or weekly summary. No customer''s name, address or phone in them.', 424),
    ('Operations', 'Order automation rules', 'Rules for paid orders: when the total, country, buyer, products, delivery, source or tags match, tag the order, notify staff or hold it from being sent. Every run is logged.', 425)
  ) AS v(category, name, description, position)
 WHERE NOT EXISTS (SELECT 1 FROM commerce.plan_features f WHERE f.name = v.name);

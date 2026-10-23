-- What each of Kaizena Flow's plans includes (D314, docs/capacity.md section 9, question 1), the owner's go-ahead on the
-- recommendation: Basic, Grow, Advanced and Plus, matched by name, so a database without those plans (local, test) gets nothing.
-- A limit already set by a platform admin is kept (on conflict do nothing). No platform default is set: a store without a plan stays
-- unlimited. Units: bytes (storage), counts, micro-dollars (AI, millionths of a US dollar). Traffic only warns (soft); bandwidth is not
-- measured yet and is left unset. Changed later on Platform → Plans → Limits.
INSERT INTO commerce.plan_limits (plan_id, key, value)
SELECT p.id, l.key, l.value
  FROM (VALUES
    -- Basic
    ('Basic', 'storage_bytes', 5::bigint * 1024 * 1024 * 1024),
    ('Basic', 'products', 500),
    ('Basic', 'staff_seats', 3),
    ('Basic', 'custom_domains', 1),
    ('Basic', 'marketing_emails_month', 2000),
    ('Basic', 'ai_cost_month_micros', 5000000),
    ('Basic', 'requests_month', 1000000),
    ('Basic', 'stores_owned', 1),
    -- Grow
    ('Grow', 'storage_bytes', 50::bigint * 1024 * 1024 * 1024),
    ('Grow', 'products', 10000),
    ('Grow', 'staff_seats', 15),
    ('Grow', 'custom_domains', 5),
    ('Grow', 'marketing_emails_month', 25000),
    ('Grow', 'ai_cost_month_micros', 20000000),
    ('Grow', 'requests_month', 5000000),
    ('Grow', 'stores_owned', 3),
    -- Advanced
    ('Advanced', 'storage_bytes', 250::bigint * 1024 * 1024 * 1024),
    ('Advanced', 'products', NULL),
    ('Advanced', 'staff_seats', 50),
    ('Advanced', 'custom_domains', 20),
    ('Advanced', 'marketing_emails_month', 150000),
    ('Advanced', 'ai_cost_month_micros', 75000000),
    ('Advanced', 'requests_month', 25000000),
    ('Advanced', 'stores_owned', 10),
    -- Plus
    ('Plus', 'storage_bytes', 1000::bigint * 1024 * 1024 * 1024),
    ('Plus', 'products', NULL),
    ('Plus', 'staff_seats', NULL),
    ('Plus', 'custom_domains', 50),
    ('Plus', 'marketing_emails_month', 500000),
    ('Plus', 'ai_cost_month_micros', 250000000),
    ('Plus', 'requests_month', NULL),
    ('Plus', 'stores_owned', 25)
  ) AS l(plan, key, value)
  JOIN commerce.plans p ON p.name = l.plan
ON CONFLICT (plan_id, key) DO NOTHING;

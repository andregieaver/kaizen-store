-- The plan comparison (D132) learns what wave 1 added (D156 to D158). The rows describe; they enable nothing, and no plan includes them
-- until the platform's admin ticks the plans that do.
-- The tax feature of the VAT migration was listed under a new category by mistake; it belongs with checkout and selling.
UPDATE commerce.plan_features SET category = 'Checkout and selling'
 WHERE name = 'EU VAT: reduced rates, VAT number check, reverse charge and IOSS marking' AND category = 'Selling';
--> statement-breakpoint
INSERT INTO commerce.plan_features (category, name, description, position)
SELECT v.category, v.name, v.description, v.position
  FROM (VALUES
    ('Operations', 'Staff roles and permissions', 'Roles for the people who work in the store (orders, products, marketing, content, analytics, read-only) with the sections each may open and change, and agency collaborators whose access ends on a date.', 481),
    ('Operations', 'Two-step sign-in for staff', 'An authenticator app as a second step when signing in to the admin, with recovery codes; required for platform admins and optional for a store.', 482),
    ('Operations', 'Activity log', 'Who changed what and when in the admin, filtered by person, area and period, with a CSV export for owners.', 483),
    ('Design and content', 'Legal page starters', 'Draft terms, privacy, shipping, returns, withdrawal information and imprint pages written from the store''s own facts, and the terms shown at checkout with a record of what the shopper accepted.', 285),
    ('Storefront and catalogue', 'Accessibility checks', 'A list of accessibility issues in a page before it is published (pictures without text, heading order, empty links, low contrast) and a draft accessibility statement.', 85)
  ) AS v(category, name, description, position)
 WHERE NOT EXISTS (SELECT 1 FROM commerce.plan_features f WHERE f.name = v.name);

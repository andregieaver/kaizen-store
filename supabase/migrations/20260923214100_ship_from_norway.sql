-- The company is Norwegian and ships from Norway to Norway, Sweden and
-- Denmark. Germany is no longer a launch market.
UPDATE commerce.markets SET active = false WHERE code = 'DE';

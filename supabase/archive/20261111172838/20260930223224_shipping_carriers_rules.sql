-- Shipping carriers (D133): a store's own agreements with carriers, prepared before the connections exist. Private: only
-- server code with a direct connection reads it, and the secrets in it are encrypted.
ALTER TABLE commerce.shipping_carriers ENABLE ROW LEVEL SECURITY;

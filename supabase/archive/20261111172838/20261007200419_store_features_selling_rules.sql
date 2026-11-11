-- Store features, step 3 (D178, docs/store-features.md 4c): the Selling group, `subscriptions`, `boxes`, `appointments` and `bookings`
-- (stays and rentals, with hosts). Each feature's switch is the gate; what it switches off is hidden and refused, nothing is deleted,
-- and past orders, subscriptions and bookings keep what they had.
--
-- * A product is offered to shoppers only while what it needs to be sold is on (`kind_offered()`): an appointment needs the feature
--   `appointments`, a stay or a rental the feature `bookings`, and a product sold only as a subscription the feature `subscriptions`.
--   Every shopper-facing product read already asks `OFFERED` (`src/server/product-conditions.ts`), which now asks this too, so a new
--   store's demo appointment, stay and rental are neither shown nor sold until the owner switches their feature on.
--
-- No existing function is changed.
--> statement-breakpoint

-- Whether a product of this kind (and sold only as a subscription or not) is offered in a store: goods bought once always; an appointment
-- while appointments are on; a stay or a rental while stays and rentals are on; one sold only as a subscription while subscriptions are on
-- (each with the online shop, `feature_on()`).
CREATE FUNCTION commerce.kind_offered(p_store uuid, p_kind text, p_subscription_only boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE p_kind
           WHEN 'appointment' THEN commerce.feature_on(p_store, 'appointments')
           WHEN 'stay' THEN commerce.feature_on(p_store, 'bookings')
           WHEN 'rental' THEN commerce.feature_on(p_store, 'bookings')
           ELSE true
         END
     AND (NOT p_subscription_only OR commerce.feature_on(p_store, 'subscriptions'))
$$;

import { parseStoreAudience, type StoreAudience } from "./b2b";
import { featureOn, type FeatureSource } from "./store-features";

/**
 * Who a store sells to as its shoppers see it (D178): the owner's choice while the feature `business` (Sell to businesses) is on, else
 * consumers. The one reading of `stores.audience`: `getStore()` gives this as `store.audience` (the owner's own choice is
 * `store.chosenAudience`), and SQL reads it as `commerce.store_audience(s.audience, s.features)`. A scan test lists the readers.
 */
export function effectiveAudience(chosen: unknown, features: FeatureSource): StoreAudience {
  return featureOn(features, "business") ? parseStoreAudience(chosen) : "consumers";
}

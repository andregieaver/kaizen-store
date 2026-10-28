/**
 * The search report's thresholds (D347), shared by the query (`src/server/analytics-search-data.ts`) and the Traffic page that explains
 * them: a term is called rarely opened only after enough searches, so a few searches never raise it.
 */

/** A term needs this many searches that found something before its click-through is called low. */
export const LOW_CLICK_MIN = 5;
/** Click-through below this share is low. */
export const LOW_CLICK_RATE = 0.1;

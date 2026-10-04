/**
 * The guards the scan test (`permissions.scan.test.ts`, wave 1, 1f) accepts in a store admin file, by name, and the wrappers that call one
 * themselves. Pure data so the test can read it without the server-only modules; `src/server/permissions.ts` re-exports both.
 */

/** A file that reaches the member by one of these is guarded; the test checks the key against the page's area where it can. */
export const GUARDS = [
  "requirePermission",
  "checkPermission",
  "requireOwnerRole",
  "checkOwnerRole",
  "requireMemberAny",
  "checkMemberAny",
  // The page builder's side actions (any of the builder's areas) and the kinds of page (each kind its own area), `src/lib/permissions.ts` `PAGE_TYPE_AREA`.
  "requireAnyPermission",
  "checkAnyPermission",
  "requirePageTypeAccess",
  "checkPageTypeAccess",
] as const;

/**
 * Wrappers that call a guard themselves, so a page or route using one needs none of its own, with the file that defines each (the test
 * checks that the file calls a guard). Add a wrapper here only after it does.
 */
export const DELEGATED_GUARDS: Record<string, string> = {
  /** The analytics pages' first call: `analytics:read` by default, and the settings page passes `owner`. */
  analyticsContext: "src/server/analytics-context.ts",
  /** The page replicator's routes (D150): `website:read` to look at a job, `website:write` to start, nudge or stop one. */
  startRequest: "src/server/replicate-route.ts",
  currentRequest: "src/server/replicate-route.ts",
  statusRequest: "src/server/replicate-route.ts",
  tickRequest: "src/server/replicate-route.ts",
  abortRequest: "src/server/replicate-route.ts",
  /** The page builder's lists and editors, for every kind of page: each calls `requirePageTypeAccess()` with the kind it was given. */
  StorePagesListView: "src/app/admin/(gated)/[store]/pages/views.tsx",
  StorePageTermsView: "src/app/admin/(gated)/[store]/pages/views.tsx",
  StoreNewPageView: "src/app/admin/(gated)/[store]/pages/views.tsx",
  StoreEditPageView: "src/app/admin/(gated)/[store]/pages/views.tsx",
  StorePreviewPageView: "src/app/admin/(gated)/[store]/pages/views.tsx",
};

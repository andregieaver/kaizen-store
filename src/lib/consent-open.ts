/** Opens the choices from anywhere on the page: the cookie page's and the footer's buttons. */
export const OPEN_CONSENT_EVENT = "kaizen:cookie-settings";
/**
 * A press of a cookie-settings button that no manager has answered yet: the manager is loaded on its own (`components/lazy/extras.tsx`), so a
 * button can be pressed before it listens. Kept in memory on the page only, never in storage; the manager opens the choices when it mounts.
 */
export const PENDING_OPEN = "__kaizenCookieSettingsPending";
export type PendingWindow = Window & { [PENDING_OPEN]?: boolean };

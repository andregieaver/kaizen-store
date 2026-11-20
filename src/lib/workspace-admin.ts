import { EXTENSION_IDS, type ExtensionId } from "./extensions";
import type { PermissionKey } from "./permission-keys";

/**
 * A standalone account's workspace in the admin (D748 E7 part three, `docs/extensions.md` 7), pure: a workspace shows only the account's
 * extensions, its settings and the AI manager. No website, shop, products, orders or bookings.
 */

/**
 * The extensions that need a store's site (A/B testing tries two versions of its pages): never offered in a workspace. The catalogue's
 * `extensions.store_only` says the same and the platform admin cannot change it (`src/db/extensions.test.ts` holds the two together).
 */
export const STORE_ONLY_EXTENSIONS: readonly ExtensionId[] = ["ab_testing"];

/** The extensions a workspace can have, in the catalogue's order. */
export const WORKSPACE_EXTENSIONS: readonly ExtensionId[] = EXTENSION_IDS.filter((id) => !STORE_ONLY_EXTENSIONS.includes(id));

/**
 * The areas a workspace's admin serves: the people (customers, deals and leads), email automation, the sales figures, support, a few settings,
 * the team, the plan and the books. Orders, products, the website and bookings are not there: their pages and actions answer as for a key
 * the member lacks (`memberCan()`), whatever the role holds.
 */
const WORKSPACE_AREAS: readonly string[] = ["customers", "marketing", "analytics", "support", "settings", "billing", "staff", "books"];

/** Whether a key works in a workspace: the owner's, or one of `WORKSPACE_AREAS`. */
export const allowedInWorkspace = (key: PermissionKey): boolean => key === "owner" || WORKSPACE_AREAS.includes(key.split(":")[0]);

/** The page each workspace extension opens on, after the workspace's address (Work lives at the account's level, D123: its own address). */
export const WORKSPACE_STARTS: Readonly<Record<Exclude<ExtensionId, "ab_testing">, string>> = {
  support_desk: "/support",
  email_automation: "/broadcasts",
  work: "",
  deals: "/deals",
};

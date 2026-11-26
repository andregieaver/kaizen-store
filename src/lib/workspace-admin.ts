import type { ExtensionId } from "./extensions";

/**
 * A standalone account's workspace in the admin (D748 E7 part three, `docs/extensions.md` 7): its Home's cards. Which keys a workspace serves
 * is `allowedInWorkspace()` (`permission-keys.ts`), and which extensions it can have `WORKSPACE_EXTENSIONS` (`extensions.ts`), so the
 * storefront, which reaches both files, loads nothing of the admin's from here.
 */

/** The page each workspace extension opens on, after the workspace's address (Work lives at the account's level, D123: its own address). */
export const WORKSPACE_STARTS: Readonly<Record<Exclude<ExtensionId, "ab_testing" | "social">, string>> = {
  support_desk: "/support",
  email_automation: "/broadcasts",
  work: "",
  deals: "/deals",
  projects: "/projects",
};

import type { Metadata } from "next";

import { OwnerSettingsView } from "@/components/admin/work/owner-settings";
import { requireAccount } from "@/server/auth";
import { getOwnerSettings, workStoresFor } from "@/server/work-owner";

import { switchActionsFor } from "../owner-page";

export const metadata: Metadata = { title: "Work settings" };

/**
 * Work's settings for the owner (D123): which stores use Work (a switch per store, owners only) and a link to each
 * store's own Work settings. Lists every store the account owns, and the ones it is an admin in that use Work.
 */
export default async function OwnerWorkSettingsPage() {
  const account = await requireAccount();
  const { using, off } = await workStoresFor(account);
  const stores = [...using, ...off].sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
  const rows = await getOwnerSettings(stores);
  return <OwnerSettingsView rows={rows} actions={switchActionsFor(rows)} />;
}

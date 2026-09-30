import type { SwitchActions } from "@/components/admin/work/owner-settings";
import type { OwnerSettingsRow } from "@/server/work-owner";

import { switchWorkAction } from "./work-owner-actions";

/**
 * The switch's server action for each store of a list, bound to the store's slug (D123), for the pages that show
 * the "Use Work in this store" switches: the settings page and the empty state of every combined page.
 */
export const switchActionsFor = (rows: readonly OwnerSettingsRow[]): SwitchActions =>
  Object.fromEntries(rows.map((row) => [row.store.slug, switchWorkAction.bind(null, row.store.slug)]));

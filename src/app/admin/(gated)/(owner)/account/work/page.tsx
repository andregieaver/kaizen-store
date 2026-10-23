import type { Metadata } from "next";

import { OwnerOverviewBody } from "@/components/admin/work/owner-overview";
import { OwnerWorkStart } from "@/components/admin/work/owner-settings";
import { requireAccount } from "@/server/auth";
import { getOwnerOverview, getOwnerSettings, workStoresFor } from "@/server/work-owner";

import { switchActionsFor } from "./owner-page";
import { workText } from "@/lib/work-text";
import { workWords } from "@/server/work-words";

export const metadata: Metadata = { title: "Work" };

/**
 * Work at the owner's level (D123, docs/work.md 6.5): what is unbilled, drafted and owed across all the account's
 * stores, per currency and per store, what needs attention, and what is running. Only stores the account belongs
 * to are read; while none uses Work the page explains it and offers the switches.
 */
export default async function OwnerWorkPage() {
  await workWords();
  const tw = workText().pagePage;
  const account = await requireAccount();
  const { using, off } = await workStoresFor(account);
  if (using.length === 0) {
    const rows = await getOwnerSettings(off);
    return <OwnerWorkStart title={tw.work} rows={rows} actions={switchActionsFor(rows)} />;
  }
  return <OwnerOverviewBody view={await getOwnerOverview(using)} stores={using} />;
}

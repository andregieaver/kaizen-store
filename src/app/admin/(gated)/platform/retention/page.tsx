import type { Metadata } from "next";
import { connection } from "next/server";

import { RetentionView } from "@/components/admin/privacy/retention-view";
import { requirePlatformAdmin } from "@/server/auth";
import { retentionOverview } from "@/server/retention";

import { changeRetentionRuleAction, verifyRetentionRuleAction } from "./actions";

export const metadata: Metadata = { title: "Data retention" };

/**
 * How long each kind of personal data is kept (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.5): the schedule with its sources and reviews,
 * the register's size and the daily job's last results. Platform admins only; a period is never edited in place.
 */
export default async function PlatformRetentionPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const overview = await retentionOverview();
  return <RetentionView overview={overview} verify={(id) => verifyRetentionRuleAction.bind(null, id)} change={changeRetentionRuleAction} today={new Date().toISOString().slice(0, 10)} />;
}

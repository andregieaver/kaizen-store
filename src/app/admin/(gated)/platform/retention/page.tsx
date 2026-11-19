import type { Metadata } from "next";
import { connection } from "next/server";

import { AdminTextScope } from "@/components/admin/admin-text";
import { RetentionView } from "@/components/admin/privacy/retention-view";
import { PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { todayIn } from "@/lib/work-dates";
import { requirePlatformReader } from "@/server/auth";
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
  const account = await requirePlatformReader();
  const overview = await retentionOverview();
  const lang = adminLangOf(account.adminLocale);
  return (
    <AdminTextScope texts={adminTexts(lang, ["privacy"])}>
      <RetentionView
        overview={overview}
        verify={(id) => verifyRetentionRuleAction.bind(null, id)}
        change={changeRetentionRuleAction}
        today={todayIn(PLATFORM_TIME_ZONE)}
        words={adminText(lang, "privacy")}
        locale={ADMIN_LANG_FACTS[lang].locale}
      />
    </AdminTextScope>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import { PeriodLinks, UsageReport } from "@/components/admin/usage-report";
import { usagePeriod } from "@/lib/ai-usage";
import { requirePlatformAdmin } from "@/server/auth";
import { usageByDay, usageRows } from "@/server/ai-usage";
import { PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "AI usage" };

/**
 * Everything the platform's AI models were used for (D106): the total, per
 * provider and model, per store owner account and per store, in the period
 * chosen. Whose key paid is shown apart, since Kaizen pays for its own.
 */
export default async function PlatformAiUsagePage({ searchParams }: PageProps<"/admin/platform/ai/usage">) {
  // The page checks for itself: the layout's check redirects in the browser, after the page's own data would already be sent.
  const account = await requirePlatformAdmin();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platformTools").usage;
  const { period } = await searchParams;
  const chosen = usagePeriod(typeof period === "string" ? period : undefined);
  const [rows, days] = await Promise.all([usageRows({ days: chosen.days }), usageByDay({ days: chosen.days })]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <PageHeader
          title={w.title}
          description={<>{fillWords(w.platformIntro, { period: (w.periods[chosen.id] ?? chosen.label).toLowerCase() })}{" "}<Link href="/admin/platform/ai" className="underline">{w.aiSettings}</Link></>}
        />
        <PeriodLinks base="/admin/platform/ai/usage" period={chosen.id} words={w} />
      </div>
      <UsageReport rows={rows} days={days} scope="platform" words={w} locale={ADMIN_LANG_FACTS[lang].locale} />
    </div>
  );
}

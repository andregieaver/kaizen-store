import type { Metadata } from "next";
import Link from "next/link";

import { PeriodLinks, UsageReport } from "@/components/admin/usage-report";
import { usagePeriod } from "@/lib/ai-usage";
import { requirePlatformAdmin } from "@/server/auth";
import { usageByDay, usageRows } from "@/server/ai-usage";

export const metadata: Metadata = { title: "AI usage" };

/**
 * Everything the platform's AI models were used for (D106): the total, per
 * provider and model, per store owner account and per store, in the period
 * chosen. Whose key paid is shown apart, since Kaizen pays for its own.
 */
export default async function PlatformAiUsagePage({ searchParams }: PageProps<"/admin/platform/ai/usage">) {
  // The page checks for itself: the layout's check redirects in the browser, after the page's own data would already be sent.
  await requirePlatformAdmin();
  const { period } = await searchParams;
  const chosen = usagePeriod(typeof period === "string" ? period : undefined);
  const [rows, days] = await Promise.all([usageRows({ days: chosen.days }), usageByDay({ days: chosen.days })]);
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-2xl font-semibold">AI usage</h1>
          <p className="text-sm text-muted">
            What every store and Kaizen itself used, {chosen.label.toLowerCase()}.{" "}
            <Link href="/admin/platform/ai" className="underline">
              AI settings
            </Link>
          </p>
        </div>
        <PeriodLinks base="/admin/platform/ai/usage" period={chosen.id} />
      </div>
      <UsageReport rows={rows} days={days} scope="platform" />
    </div>
  );
}

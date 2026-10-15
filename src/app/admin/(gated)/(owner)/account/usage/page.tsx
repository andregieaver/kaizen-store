import type { Metadata } from "next";
import Link from "next/link";

import { PeriodLinks, UsageReport } from "@/components/admin/usage-report";
import { usagePeriod } from "@/lib/ai-usage";
import { requireAccount } from "@/server/auth";
import { ownedStores, usageByDay, usageRows } from "@/server/ai-usage";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "AI usage" };

/**
 * A store owner's AI usage (D106): the stores they own together, per
 * provider and model, and per store, in the period chosen; one store when
 * chosen. Only stores the account owns are counted.
 */
export default async function OwnerAiUsagePage({ searchParams }: PageProps<"/admin/account/usage">) {
  const account = await requireAccount();
  const query = await searchParams;
  const chosen = usagePeriod(typeof query.period === "string" ? query.period : undefined);
  const owned = await ownedStores(account.id);
  const store = typeof query.store === "string" ? owned.find((s) => s.slug === query.store) : undefined;
  const [rows, days] =
    owned.length === 0
      ? [[], []]
      : await Promise.all([
          usageRows({ days: chosen.days, ownedBy: account.id, storeId: store?.id ?? null }),
          usageByDay({ days: chosen.days, ownedBy: account.id, storeId: store?.id ?? null }),
        ]);
  const base = "/admin/account/usage";
  const keep = store ? `&store=${store.slug}` : "";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <PageHeader
          title="AI usage"
          description={<>What the AI used for {store ? store.name : owned.length === 1 ? owned[0].name : "the stores you own"}, {chosen.label.toLowerCase()}. Kaizena Flow&apos;s AI is included in your plan; usage on a key of your own is billed by that provider.</>}
        />
        <PeriodLinks base={base} period={chosen.id} extra={keep} />
        {owned.length > 1 && (
          <nav aria-label="Store" className="flex flex-wrap gap-1 text-sm">
            <Link href={`${base}?period=${chosen.id}`} aria-current={!store ? "page" : undefined} className={`rounded-pill px-3 py-1.5 ${!store ? "bg-sunken font-medium" : "text-muted hover:bg-sunken"}`}>
              All my stores
            </Link>
            {owned.map((s) => (
              <Link
                key={s.slug}
                href={`${base}?period=${chosen.id}&store=${s.slug}`}
                aria-current={store?.slug === s.slug ? "page" : undefined}
                className={`rounded-pill px-3 py-1.5 ${store?.slug === s.slug ? "bg-sunken font-medium" : "text-muted hover:bg-sunken"}`}
              >
                {s.name}
              </Link>
            ))}
          </nav>
        )}
      </div>
      {owned.length === 0 ? (
        <p className="rounded-panel border border-line p-4 text-sm">You do not own a store yet, so there is no usage to show.</p>
      ) : (
        <UsageReport rows={rows} days={days} scope="owner" />
      )}
    </div>
  );
}

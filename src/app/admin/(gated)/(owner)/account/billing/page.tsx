import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { Section, Stat, StatGrid } from "@/components/admin/overview-parts";
import { money } from "@/lib/control-center";
import { requireAccount } from "@/server/auth";
import { ownedStores } from "@/server/ai-usage";
import { listStoreBilling, type StoreBilling } from "@/server/billing";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Billing" };


/** A plan's cost per month, for adding up plans of different intervals. */
const monthly = (price: NonNullable<StoreBilling["price"]>) => Math.round(price.interval === "year" ? price.amountMinor / 12 : price.amountMinor);

/**
 * The plans of every store the account owns in one place (D107): what each
 * costs, whether it is paid, when it renews, and Kaizen's fee on its sales;
 * a store's own page (Billing in its admin) changes the plan.
 */
export default async function OwnerBillingPage() {
  await connection();
  const account = await requireAccount();
  const b = adminText(adminLangOf(account.adminLocale), "billing");
  const w = b.owner;
  const per = (price: NonNullable<StoreBilling["price"]>) =>
    fillWords(w.per, { price: money(price.amountMinor, price.currency), interval: b.intervals[price.interval as keyof typeof b.intervals] ?? price.interval });
  const owned = await ownedStores(account.id);
  const bySlug = new Map((await listStoreBilling()).map((b) => [b.slug, b]));
  const rows = owned.flatMap((s) => bySlug.get(s.slug) ?? []);

  const costs = new Map<string, number>();
  for (const row of rows) if (row.price && ["active", "trialing", "past_due"].includes(row.status ?? "")) costs.set(row.price.currency, (costs.get(row.price.currency) ?? 0) + monthly(row.price));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={w.title} description={w.description} />
      {rows.length === 0 ? (
        <p className="rounded-panel border border-line p-4 text-sm">{w.none}</p>
      ) : (
        <>
          <StatGrid>
            {[...costs].map(([currency, minor]) => (
              <Stat key={currency} label={fillWords(w.perMonth, { currency })} value={money(minor, currency)} sub={w.yearlyCounted} />
            ))}
            <Stat label={w.withoutPlan} value={rows.filter((r) => !r.status || ["canceled", "incomplete", "incomplete_expired"].includes(r.status)).length} />
          </StatGrid>
          <Section id="plans-heading" title={w.plans}>
            <ul className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
              {rows.map((row) => (
                <li key={row.slug} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <span className="min-w-40 flex-1">
                    <span className="block font-medium">{row.name}</span>
                    <span className="block text-muted">{row.planName ?? w.noPlan}{row.price ? ` · ${per(row.price)}` : ""}</span>
                  </span>
                  <span className={row.status && ["past_due", "unpaid"].includes(row.status) ? "font-medium text-danger-text" : "text-muted"}>{row.status ? (b.statuses[row.status] ?? row.status) : w.noPlan}</span>
                  <span className="text-muted">
                    {row.currentPeriodEnd ? fillWords(row.cancelAtPeriodEnd ? w.ends : w.renews, { date: row.currentPeriodEnd.slice(0, 10) }) : ""}
                  </span>
                  <span className="text-muted">{fillWords(w.fee, { fee: (row.feeBps / 100).toFixed(row.feeBps % 100 === 0 ? 0 : 1) })}</span>
                  <Link href={`/admin/${row.slug}/billing`} className="underline">
                    {w.manage}
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { Section, Stat, StatGrid } from "@/components/admin/overview-parts";
import { money } from "@/lib/control-center";
import { requireAccount } from "@/server/auth";
import { ownedStores } from "@/server/ai-usage";
import { listStoreBilling, type StoreBilling } from "@/server/billing";

export const metadata: Metadata = { title: "Billing" };

const STATUS: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Overdue",
  unpaid: "Overdue",
  canceled: "Cancelled",
  incomplete: "Not finished",
  incomplete_expired: "Not finished",
  paused: "Paused",
};

const per = (price: NonNullable<StoreBilling["price"]>) => `${money(price.amountMinor, price.currency)} / ${price.interval}`;

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
  const owned = await ownedStores(account.id);
  const bySlug = new Map((await listStoreBilling()).map((b) => [b.slug, b]));
  const rows = owned.flatMap((s) => bySlug.get(s.slug) ?? []);

  const costs = new Map<string, number>();
  for (const row of rows) if (row.price && ["active", "trialing", "past_due"].includes(row.status ?? "")) costs.set(row.price.currency, (costs.get(row.price.currency) ?? 0) + monthly(row.price));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-muted">The plan of each store you own, what it costs and when it renews. Change a plan in the store&apos;s own billing.</p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-border p-4 text-sm">You do not own a store yet, so there are no plans to show.</p>
      ) : (
        <>
          <StatGrid>
            {[...costs].map(([currency, minor]) => (
              <Stat key={currency} label={`Plans per month (${currency})`} value={money(minor, currency)} sub="Yearly plans counted by the month" />
            ))}
            <Stat label="Stores without a plan" value={rows.filter((r) => !r.status || ["canceled", "incomplete", "incomplete_expired"].includes(r.status)).length} />
          </StatGrid>
          <Section id="plans-heading" title="Your stores' plans">
            <ul className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
              {rows.map((row) => (
                <li key={row.slug} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <span className="min-w-40 flex-1">
                    <span className="block font-medium">{row.name}</span>
                    <span className="block text-muted">{row.planName ?? "No plan"}{row.price ? ` · ${per(row.price)}` : ""}</span>
                  </span>
                  <span className={row.status && ["past_due", "unpaid"].includes(row.status) ? "font-medium text-red-700 dark:text-red-400" : "text-muted"}>{row.status ? (STATUS[row.status] ?? row.status) : "No plan"}</span>
                  <span className="text-muted">
                    {row.currentPeriodEnd ? `${row.cancelAtPeriodEnd ? "Ends" : "Renews"} ${row.currentPeriodEnd.slice(0, 10)}` : ""}
                  </span>
                  <span className="text-muted">{(row.feeBps / 100).toFixed(row.feeBps % 100 === 0 ? 0 : 1)} % fee on sales</span>
                  <Link href={`/admin/${row.slug}/billing`} className="underline">
                    Manage
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

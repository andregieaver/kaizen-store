import type { Metadata } from "next";
import Link from "next/link";

import { describeDelay } from "@/lib/cart-reminders";
import { formatMoney } from "@/lib/money";
import {
  getPlanReminderSettings,
  listAbandonedPlanCheckouts,
  planReminderStats,
  type AbandonedPlanRow,
} from "@/server/plan-reminders";
import { listPlatformDiscounts } from "@/server/platform-discounts";

import { setPlanRemindersAction } from "./actions";

export const metadata: Metadata = { title: "Plan reminders" };

const STATUS: Record<AbandonedPlanRow["status"], string> = {
  waiting: "Waiting",
  reminded: "Reminded",
  recovered: "On a plan after a reminder",
  bought: "On a plan",
  opted_out: "Opted out",
  expired: "No more reminders",
};

const tile = "flex flex-col gap-1 rounded-lg border border-border bg-background p-4";

/**
 * Kaizen's reminders to store owners who went to pay for a plan and did
 * not finish (D33): the platform's side of the stores' cart reminders.
 */
export default async function PlanRemindersPage() {
  const [settings, stats, checkouts, discounts] = await Promise.all([
    getPlanReminderSettings(),
    planReminderStats(),
    listAbandonedPlanCheckouts(),
    listPlatformDiscounts(),
  ]);
  const base = "/admin/platform/plan-reminders";
  const codeOf = (id: string | null) => discounts.find((d) => d.id === id)?.code ?? null;
  const date = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  const active = settings.steps.filter((s) => s.active).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Plan reminders</h1>
        <p className="text-sm text-muted">
          Emails to store owners who went to pay for a plan and did not finish, with a link straight back to paying.
        </p>
      </div>

      <section aria-labelledby="switch-heading" className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-background p-5">
        <div className="flex max-w-2xl flex-col gap-2 text-sm">
          <h2 id="switch-heading" className="text-base font-medium">
            {settings.enabled ? (active > 0 ? "Reminders are on" : "On, but every reminder is switched off") : "Reminders are off"}
          </h2>
          <p>
            {settings.enabled
              ? "When an owner goes to Stripe to pay for a plan, Kaizen keeps their email and the plan. The Plan page and Stripe's page say a reminder may come; the Plan page and every reminder let the owner say no. Reminders stop once the store is on a plan, and emails are erased after 60 days."
              : "Turn them on to start with three reminders, after an hour, a day and three days, which you can change."}
          </p>
        </div>
        <form action={setPlanRemindersAction.bind(null, !settings.enabled)}>
          <button
            type="submit"
            className={
              settings.enabled
                ? "min-h-10 rounded-md border border-border px-4 text-sm"
                : "min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background"
            }
          >
            {settings.enabled ? "Turn off" : "Turn on"}
          </button>
        </form>
      </section>

      <section aria-labelledby="stats-heading" className="flex flex-col gap-3">
        <h2 id="stats-heading" className="font-medium">
          The last 30 days
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <div className={tile}>
            <span className="text-sm text-muted">Went to pay</span>
            <span className="text-2xl font-semibold">{stats.captured}</span>
          </div>
          <div className={tile}>
            <span className="text-sm text-muted">Reminded</span>
            <span className="text-2xl font-semibold">{stats.reminded}</span>
          </div>
          <div className={tile}>
            <span className="text-sm text-muted">On a plan after a reminder</span>
            <span className="text-2xl font-semibold">{stats.recovered}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="steps-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="steps-heading" className="font-medium">
            Reminders
          </h2>
          <Link href={`${base}/new`} className="min-h-10 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
            New reminder
          </Link>
        </div>
        {settings.steps.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
            No reminders yet. Turn reminders on to start with three, or make one.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-4 py-2 font-medium">Sent after</th>
                  <th scope="col" className="px-4 py-2 font-medium">Subject</th>
                  <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Code</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {settings.steps.map((step) => (
                  <tr key={step.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-4 py-2">{describeDelay(step.delayMinutes)}</td>
                    <td className="px-4 py-2">{step.content.en?.subject ?? Object.values(step.content)[0]?.subject}</td>
                    <td className="hidden px-4 py-2 font-mono sm:table-cell">{codeOf(step.discountCodeId) ?? "—"}</td>
                    <td className="px-4 py-2">{step.active ? "On" : "Switched off"}</td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`${base}/${step.id}`} className="underline">
                        Edit<span className="sr-only"> the reminder after {describeDelay(step.delayMinutes)}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="checkouts-heading" className="flex flex-col gap-3">
        <h2 id="checkouts-heading" className="font-medium">
          Latest
        </h2>
        {checkouts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
            Nothing yet. Owners show here once they go to pay for a plan.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-4 py-2 font-medium">Store</th>
                  <th scope="col" className="px-4 py-2 font-medium">Plan</th>
                  <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Went to pay</th>
                  <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Reminders</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {checkouts.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      <Link href={`/admin/platform/stores`} className="underline">
                        {row.storeName}
                      </Link>
                      <span className="block max-w-56 truncate text-muted">{row.email ?? "Email erased"}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      {row.planName} · {formatMoney(row.amountMinor, row.currency, "nb-NO")} / {row.interval}
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-2 md:table-cell">{date(row.capturedAt)}</td>
                    <td className="hidden px-4 py-2 sm:table-cell">
                      {row.remindersSent}
                      {row.clickedAt && <span className="text-muted"> · opened the link</span>}
                    </td>
                    <td className="px-4 py-2">{STATUS[row.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

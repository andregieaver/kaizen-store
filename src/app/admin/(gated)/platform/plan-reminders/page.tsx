import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

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
import { requirePlatformAdmin } from "@/server/auth";
import { Button, Card, Chip, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Plan reminders" };

const STATUS: Record<AbandonedPlanRow["status"], string> = {
  waiting: "Waiting",
  reminded: "Reminded",
  recovered: "On a plan after a reminder",
  bought: "On a plan",
  opted_out: "Opted out",
  expired: "No more reminders",
};

const STATUS_SIGNAL = { waiting: "insight", reminded: "warning", recovered: "positive", bought: "positive", opted_out: "neutral", expired: "neutral" } as const;

const tile = "flex flex-col gap-1 rounded-lg border border-line bg-card p-4";

/**
 * Kaizen's reminders to store owners who went to pay for a plan and did
 * not finish (D33): the platform's side of the stores' cart reminders.
 */
export default async function PlanRemindersPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
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
      <PageHeader
        title="Plan reminders"
        description={<>Emails to store owners who went to pay for a plan and did not finish, with a link straight back to paying.</>}
      />

      <Card
        title={<>{settings.enabled ? (active > 0 ? "Reminders are on" : "On, but every reminder is switched off") : "Reminders are off"}</>}
        aside={
          <form action={setPlanRemindersAction.bind(null, !settings.enabled)}>
            <Button type="submit" kind={settings.enabled ? "secondary" : "main"}>
              {settings.enabled ? "Turn off" : "Turn on"}
            </Button>
          </form>
        }
        compact
      >
        <div className="max-w-2xl text-body text-ink-2">
          <p>
            {settings.enabled
              ? "When an owner goes to Stripe to pay for a plan, Kaizen keeps their email and the plan. The owner's Billing page and Stripe's page say a reminder may come; the Billing page and every reminder let the owner say no. Reminders stop once the store is on a plan, and emails are erased after 60 days."
              : "Turn them on to start with three reminders, after an hour, a day and three days, which you can change."}
          </p>
        </div>
      </Card>

      <section aria-labelledby="stats-heading" className="flex flex-col gap-3">
        <h2 id="stats-heading" className="font-medium">
          The last 30 days
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <div className={tile}>
            <span className="text-sm text-muted">Went to pay</span>
            <span className="text-2xl font-medium">{stats.captured}</span>
          </div>
          <div className={tile}>
            <span className="text-sm text-muted">Reminded</span>
            <span className="text-2xl font-medium">{stats.reminded}</span>
          </div>
          <div className={tile}>
            <span className="text-sm text-muted">On a plan after a reminder</span>
            <span className="text-2xl font-medium">{stats.recovered}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="steps-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="steps-heading" className="font-medium">
            Reminders
          </h2>
          <Link href={`${base}/new`} className="min-h-10 rounded-pill bg-brand px-4 py-2 text-sm font-medium text-brand-ink">
            New reminder
          </Link>
        </div>
        {settings.steps.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-card p-8 text-center text-sm text-muted">
            No reminders yet. Turn reminders on to start with three, or make one.
          </p>
        ) : (
          <Card compact>
            <List label="Reminders">
              {settings.steps.map((step) => (
                <ListRow key={step.id}>
                  <RowLead
                    title={`After ${describeDelay(step.delayMinutes)}`}
                    href={`${base}/${step.id}`}
                    sub={
                      <>
                        {step.content.en?.subject ?? Object.values(step.content)[0]?.subject}
                        {codeOf(step.discountCodeId) && (
                          <>
                            {" · code "}
                            <span className="font-mono">{codeOf(step.discountCodeId)}</span>
                          </>
                        )}
                      </>
                    }
                  />
                  <Chip signal={step.active ? "positive" : "neutral"} dot>
                    {step.active ? "On" : "Switched off"}
                  </Chip>
                </ListRow>
              ))}
            </List>
          </Card>
        )}
      </section>

      <section aria-labelledby="checkouts-heading" className="flex flex-col gap-3">
        <h2 id="checkouts-heading" className="font-medium">
          Latest
        </h2>
        {checkouts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-card p-8 text-center text-sm text-muted">
            Nothing yet. Owners show here once they go to pay for a plan.
          </p>
        ) : (
          <Card compact>
            <List label="Checkouts">
              {checkouts.map((row) => (
                <ListRow key={row.id}>
                  <RowLead
                    title={row.storeName}
                    href="/admin/platform/stores"
                    sub={
                      <>
                        <span className="inline-block max-w-56 truncate align-bottom">{row.email ?? "Email erased"}</span> · {row.planName} ·{" "}
                        {formatMoney(row.amountMinor, row.currency, "nb-NO")} / {row.interval}
                      </>
                    }
                  />
                  <RowFact className="hidden md:block">Went to pay {date(row.capturedAt)}</RowFact>
                  <RowFact className="hidden sm:block" sub={row.clickedAt ? "opened the link" : undefined}>
                    {row.remindersSent === 1 ? "1 reminder" : `${row.remindersSent} reminders`}
                  </RowFact>
                  <Chip signal={STATUS_SIGNAL[row.status]} dot>
                    {STATUS[row.status]}
                  </Chip>
                </ListRow>
              ))}
            </List>
          </Card>
        )}
      </section>
    </div>
  );
}

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
import { Button, Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Plan reminders" };

const STATUS_SIGNAL = { waiting: "insight", reminded: "warning", recovered: "positive", bought: "positive", opted_out: "neutral", expired: "neutral" } as const;

const tile = "flex flex-col gap-1 rounded-lg border border-line bg-card p-4";

/**
 * Kaizen's reminders to store owners who went to pay for a plan and did
 * not finish (D33): the platform's side of the stores' cart reminders.
 */
export default async function PlanRemindersPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformAdmin();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platform").planReminders;
  const STATUS: Record<AbandonedPlanRow["status"], string> = w.status;
  const [settings, stats, checkouts, discounts] = await Promise.all([
    getPlanReminderSettings(),
    planReminderStats(),
    listAbandonedPlanCheckouts(),
    listPlatformDiscounts(),
  ]);
  const base = "/admin/platform/plan-reminders";
  const codeOf = (id: string | null) => discounts.find((d) => d.id === id)?.code ?? null;
  const date = (iso: string) => new Date(iso).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  const active = settings.steps.filter((s) => s.active).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={w.description}
      />

      <Card
        title={settings.enabled ? (active > 0 ? w.on : w.onAllOff) : w.off}
        aside={
          <form action={setPlanRemindersAction.bind(null, !settings.enabled)}>
            <Button type="submit" kind={settings.enabled ? "secondary" : "main"}>
              {settings.enabled ? w.turnOff : w.turnOn}
            </Button>
          </form>
        }
        compact
      >
        <div className="max-w-2xl text-body text-ink-2">
          <p>
            {settings.enabled
              ? w.onNote
              : w.offNote}
          </p>
        </div>
      </Card>

      <section aria-labelledby="stats-heading" className="flex flex-col gap-3">
        <h2 id="stats-heading" className="text-title text-ink">
          {w.last30}
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <div className={tile}>
            <span className="text-sm text-muted">{w.wentToPay}</span>
            <span className="text-metric text-ink tabular-nums">{stats.captured}</span>
          </div>
          <div className={tile}>
            <span className="text-sm text-muted">{w.reminded}</span>
            <span className="text-metric text-ink tabular-nums">{stats.reminded}</span>
          </div>
          <div className={tile}>
            <span className="text-sm text-muted">{w.recovered}</span>
            <span className="text-metric text-ink tabular-nums">{stats.recovered}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="steps-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="steps-heading" className="text-title text-ink">
            {w.reminders}
          </h2>
          <Link href={`${base}/new`} className="min-h-10 rounded-pill bg-brand px-4 py-2 text-sm font-medium text-brand-ink">
            {w.newReminder}
          </Link>
        </div>
        {settings.steps.length === 0 ? (
          <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
            {w.none}
          </p>
        ) : (
          <Card compact>
            <List label={w.reminders}>
              {settings.steps.map((step) => (
                <ListRow key={step.id}>
                  <RowLead
                    title={fillWords(w.after, { delay: describeDelay(step.delayMinutes, adminText(lang, "platform").delay) })}
                    href={`${base}/${step.id}`}
                    sub={
                      <>
                        {step.content.en?.subject ?? Object.values(step.content)[0]?.subject}
                        {codeOf(step.discountCodeId) && (
                          <>
                            {w.code}
                            <span className="font-mono">{codeOf(step.discountCodeId)}</span>
                          </>
                        )}
                      </>
                    }
                  />
                  <Chip signal={step.active ? "positive" : "neutral"} dot>
                    {step.active ? w.stepOn : w.stepOff}
                  </Chip>
                </ListRow>
              ))}
            </List>
          </Card>
        )}
      </section>

      <section aria-labelledby="checkouts-heading" className="flex flex-col gap-3">
        <h2 id="checkouts-heading" className="text-title text-ink">
          {w.latest}
        </h2>
        {checkouts.length === 0 ? (
          <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
            {w.nothing}
          </p>
        ) : (
          <Card compact>
            <List label={w.checkouts}>
              {checkouts.map((row) => (
                <ListRow key={row.id}>
                  <RowLead
                    title={row.storeName}
                    href="/admin/platform/stores"
                    sub={
                      <>
                        <span className="inline-block max-w-56 truncate align-bottom">{row.email ?? w.erased}</span> · {row.planName} ·{" "}
                        {formatMoney(row.amountMinor, row.currency, "nb-NO")} / {row.interval}
                      </>
                    }
                  />
                  <RowFact className="hidden md:block">{fillWords(w.wentOn, { date: date(row.capturedAt) })}</RowFact>
                  <RowFact className="hidden sm:block" sub={row.clickedAt ? w.opened : undefined}>
                    {row.remindersSent === 1 ? w.oneReminder : fillWords(w.remindersSent, { n: row.remindersSent })}
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

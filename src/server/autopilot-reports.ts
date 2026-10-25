import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { adminLangOf, ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { addDays, customPeriod, startOfWeek, todayIn } from "@/lib/analytics-period";
import { autopilotEmail, checkedNote, digestWorthSending, reportFactsSchema, STEPS_LISTED, type ReportFacts } from "@/lib/autopilot-report";
import { renderEmail } from "@/lib/email-layout";
import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { UNTRUSTED_TEXT } from "@/lib/prompt-safety";
import { siteUrl } from "@/lib/site";

import { aiFor, AiError, completeText, type AiConnection } from "./ai";
import { periodTotals } from "./analytics-totals";
import { activeAccount, passMembership, type Account } from "./auth";
import { goalsWithProgress } from "./autopilot-goals";
import { aiBudgetSpent, autonomyFor } from "./autopilot-settings";
import { sendEmail, type OutgoingEmail, type SendOutcome } from "./email";
import { log } from "./log";
import { currentStore, type Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The autopilot's daily digest and weekly report (D309, `docs/ai-autopilot.md` 7.5), the only writer of `commerce.autopilot_reports`, from the
 * five-minute dispatcher. To each person whose plan ran lately in a store (or on Kaizena Flow's site), with their role read again: a digest
 * once a day after 18:00 in the store's time when a step finished or something waits for them, and a report once a week from Monday 08:00
 * with the store's figures (`periodTotals()`), their goals and, when the AI may, a few sentences checked by `checkedNote()`. A period's row is
 * claimed before its email goes, so each is sent once.
 */

const DIGEST_HOUR = 18;
const WEEKLY_HOUR = 8;
const PER_RUN = 20;

export type ReportDeps = {
  now?: Date;
  send?: (message: OutgoingEmail) => Promise<SendOutcome>;
  /** The AI connection the weekly note uses; the store's for the feature `autopilot` unless given (tests). */
  connection?: AiConnection | null;
};

export type ReportRun = { daily: number; weekly: number };

const RECIPIENT = z.object({ store_id: col.uuid.nullable(), account_id: col.uuid, slug: col.textOrNull, time_zone: col.textOrNull });

export async function sendAutopilotReports(deps: ReportDeps = {}): Promise<ReportRun> {
  const now = deps.now ?? new Date();
  const run: ReportRun = { daily: 0, weekly: 0 };
  const recipients = await typedRows(
    RECIPIENT,
    sql`
      select distinct p.store_id, p.account_id, s.slug, s.time_zone
      from commerce.assistant_plans p left join commerce.stores s on s.id = p.store_id
      where (p.status in ('running', 'paused') or (p.status in ('done', 'stopped') and p.finished_at > now() - interval '8 days'))
        and (p.store_id is null or commerce.store_is_active(p.store_id))
      limit ${PER_RUN * 5}
    `,
  );
  for (const r of recipients) {
    if (run.daily + run.weekly >= PER_RUN) break;
    try {
      const who = await recipientOf(r);
      if (!who) continue;
      const zone = who.store?.timeZone ?? "UTC";
      const today = todayIn(now, zone);
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(now));
      const weekStart = startOfWeek(today);
      if (hour >= WEEKLY_HOUR || today !== weekStart) {
        if (await sendOne(who, "weekly", weekStart, now, deps)) run.weekly++;
      }
      if (hour >= DIGEST_HOUR) {
        if (await sendOne(who, "daily", today, now, deps)) run.daily++;
      }
    } catch (error) {
      log("error", "autopilot.report_failed", { store: r.store_id, account: r.account_id }, error);
    }
  }
  return run;
}

type Recipient = { account: Account; store: Store | null };

async function recipientOf(r: z.output<typeof RECIPIENT>): Promise<Recipient | null> {
  const account = await activeAccount(r.account_id);
  if (!account?.email) return null;
  if (!r.store_id) return account.platformAdmin ? { account, store: null } : null;
  if (!r.slug) return null;
  const member = await passMembership(r.slug, account.id);
  if (!member) return null;
  return { account: member.account, store: (await currentStore(r.slug)) ?? member.store };
}

const scopeOf = (store: Store | null, column = sql`store_id`) => (store ? sql`${column} = ${store.id}::uuid` : sql`${column} is null`);

/** What the person's plans did and what waits for them, over the last days. */
async function workFacts(who: Recipient, days: number): Promise<Pick<ReportFacts, "stepsDone" | "stepsDoneCount" | "waiting" | "legal">> {
  const done = await typedRows(
    z.object({ title: col.text }),
    sql`
      select s.title from commerce.assistant_plan_steps s join commerce.assistant_plans p on p.id = s.plan_id
      where ${scopeOf(who.store, sql`p.store_id`)} and p.account_id = ${who.account.id}::uuid
        and s.status = 'done' and s.finished_at > now() - make_interval(days => ${days})
      order by s.finished_at
    `,
  );
  const waiting = await typedRow(
    z.object({ n: col.int }),
    sql`
      select (
        (select count(*) from commerce.assistant_approvals a where ${scopeOf(who.store, sql`a.store_id`)} and a.account_id = ${who.account.id}::uuid and a.status = 'pending')
        + (select count(*) from commerce.assistant_plan_steps s join commerce.assistant_plans p on p.id = s.plan_id
           where ${scopeOf(who.store, sql`p.store_id`)} and p.account_id = ${who.account.id}::uuid and s.status = 'asking' and p.status in ('running', 'paused'))
      )::int as n
    `,
  );
  // The legal pages the AI wrote for the store in the period (D311): counts only; the Legal page says what each was.
  const legal = who.store
    ? await typedRow(
        z.object({ published: col.int, drafted: col.int, failed: col.int }),
        sql`
          select count(*) filter (where status = 'published')::int as published,
            count(*) filter (where status in ('written', 'kept'))::int as drafted,
            count(*) filter (where status = 'failed')::int as failed
          from commerce.legal_ai_writes where store_id = ${who.store.id}::uuid and finished_at > now() - make_interval(days => ${days})
        `,
      )
    : null;
  return {
    stepsDone: done.slice(0, STEPS_LISTED).map((d) => d.title),
    stepsDoneCount: done.length,
    waiting: waiting?.n ?? 0,
    ...(legal && legal.published + legal.drafted + legal.failed > 0 ? { legal } : {}),
  };
}

/** The store's net sales and orders of the last 7 store days and the 7 before, written by code; not measured when a currency has no rate. */
async function figures(store: Store, today: string): Promise<Pick<ReportFacts, "sales" | "orders">> {
  const last = addDays(today, -1);
  const [now, before] = await Promise.all([
    periodTotals(store, customPeriod(addDays(last, -6), last)),
    periodTotals(store, customPeriod(addDays(last, -13), addDays(last, -7))),
  ]);
  const currency = mainCurrency(store);
  const locale = store.markets[0]?.locale ?? "en-GB";
  const net = (t: typeof now) => (t.unconverted > 0 ? null : formatMoney(t.totals.revenueMinor - t.totals.refundsMinor, currency, locale));
  const count = (t: typeof now) => (t.unconverted > 0 ? null : t.totals.orders);
  return { sales: { now: net(now), before: net(before) }, orders: { now: count(now), before: count(before) } };
}

/** A few sentences on concerns and next steps, from the facts only; null without a model, past the budget, or when they fail the checks. */
async function noteFor(who: Recipient, facts: ReportFacts, deps: ReportDeps): Promise<string | null> {
  const storeId = who.store?.id ?? null;
  if (await aiBudgetSpent(storeId, await autonomyFor(storeId))) return null;
  const connection = deps.connection !== undefined ? deps.connection : await aiFor(storeId, { feature: "autopilot", accountId: who.account.id });
  if (!connection?.textModel) return null;
  const lang = adminLangOf(who.account.adminLocale ?? null);
  try {
    const answer = await completeText(
      connection,
      [
        {
          role: "system",
          content: [
            "You write the closing note of a shop owner's weekly report from their store's autopilot: two to four short, plain sentences on what looks like a concern and what would be sensible to do next.",
            UNTRUSTED_TEXT,
            "Use only the facts you are given. Write no numbers, amounts, dates or percentages at all, and promise nothing.",
            `Write in ${ADMIN_LANG_FACTS[lang].name}.`,
          ].join("\n"),
        },
        { role: "user", content: JSON.stringify(facts) },
      ],
      { maxTokens: 300, timeoutMs: 30_000 },
    );
    return checkedNote(answer.text);
  } catch (error) {
    if (!(error instanceof AiError)) log("error", "autopilot.report_note_failed", { store: storeId }, error);
    return null;
  }
}

/** One digest or report: facts gathered, the period claimed, the email sent. True when one went. */
async function sendOne(who: Recipient, kind: "daily" | "weekly", periodStart: string, now: Date, deps: ReportDeps): Promise<boolean> {
  const storeId = who.store?.id ?? null;
  const exists = await typedRow(
    z.object({ id: col.uuid }),
    sql`select id from commerce.autopilot_reports where ${scopeOf(who.store)} and account_id = ${who.account.id}::uuid and kind = ${kind} and period_start = ${periodStart}::date`,
  );
  if (exists) return false;
  const work = await workFacts(who, kind === "daily" ? 1 : 7);
  if (kind === "daily" && !digestWorthSending(work)) return false;
  const facts: ReportFacts = { kind, store: who.store?.name ?? null, ...work };
  if (kind === "weekly") {
    if (who.store) Object.assign(facts, await figures(who.store, todayIn(now, who.store.timeZone)));
    const goals = await goalsWithProgress(who, { now });
    facts.goals = goals.filter((g) => g.status !== "dropped").map((g) => ({ title: g.title, met: g.progress.filter((p) => p.met === true).length, all: g.progress.length }));
  }
  const note = kind === "weekly" ? await noteFor(who, facts, deps) : null;
  const claimed = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      insert into commerce.autopilot_reports (store_id, account_id, kind, period_start, facts, note)
      values (${storeId}::uuid, ${who.account.id}::uuid, ${kind}, ${periodStart}::date, ${JSON.stringify(facts)}::jsonb, ${note})
      on conflict (store_id, account_id, kind, period_start) do nothing
      returning id
    `,
  );
  if (!claimed) return false;
  const lang = adminLangOf(who.account.adminLocale ?? null);
  const url = `${siteUrl()}/admin/${who.store?.slug ?? "platform"}/assistant/autopilot`;
  try {
    await (deps.send ?? sendEmail)({
      storeId,
      kind: kind === "daily" ? "autopilot.digest" : "autopilot.weekly",
      to: who.account.email,
      email: renderEmail(autopilotEmail(facts, url, note, adminText(lang, "staffEmails"), lang)),
      fromName: "Kaizena Flow",
      idempotencyKey: `autopilot.${kind}:${storeId ?? "platform"}:${who.account.id}:${periodStart}`,
    });
    await db().execute(sql`update commerce.autopilot_reports set sent_at = now() where id = ${claimed.id}::uuid`);
  } catch (error) {
    log("error", "autopilot.report_email_failed", { report: claimed.id }, error);
  }
  return true;
}

/** The person's latest weekly report here, for the page. */
export async function latestReport(who: { account: { id: string }; store: Store | null }): Promise<{ periodStart: string; facts: ReportFacts; note: string | null } | null> {
  const row = await typedRow(
    z.object({ period_start: col.text, facts: z.unknown(), note: col.textOrNull }),
    sql`
      select period_start::text as period_start, facts, note from commerce.autopilot_reports
      where ${scopeOf(who.store)} and account_id = ${who.account.id}::uuid and kind = 'weekly'
      order by period_start desc limit 1
    `,
  );
  if (!row) return null;
  const facts = reportFactsSchema.safeParse(row.facts);
  return facts.success ? { periodStart: row.period_start, facts: facts.data, note: row.note } : null;
}

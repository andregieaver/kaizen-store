import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf, type AdminLang } from "@/lib/admin-lang";
import type { CustomReportsMessages } from "@/lib/admin-messages/custom-reports.en";
import { adminText } from "@/lib/admin-text";
import { formatNumber, formatPercent } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import { renderEmail, type EmailBlock, type RenderedEmail } from "@/lib/email-layout";
import { emailText } from "@/lib/email-text";
import { permissionsOf } from "@/lib/permissions";
import { METRICS, type MetricKey } from "@/lib/report-catalogue";
import { reportLink } from "@/lib/report-link";
import {
  readScheduleInput,
  REPORT_EMAIL_ROWS,
  REPORT_SCHEDULES_MAX,
  scheduleDue,
  type ReportFrequency,
  type ScheduleProblem,
} from "@/lib/report-schedules";
import { siteUrl } from "@/lib/site";
import { localNow } from "@/lib/staff-alerts";

import { audit } from "./auth";
import { sendEmail } from "./email";
import { log } from "./log";
import { reportCsv } from "./report-export";
import { labelOf, reportLabels } from "./report-labels";
import { runReport, type ReportResult, type ReportValues } from "./report-query";
import { getSavedReport } from "./saved-reports";
import { emailFooter, storeById, type EmailStore } from "./shopper-emails";
import { getStore } from "./stores";
import { col, typedRows } from "./typed-rows";

/**
 * Saved reports emailed on a schedule (wave 12 unit A, D395). The only writer of `commerce.report_schedules`. A schedule names one of the
 * store's saved reports, how often and at what hour on the store's clock, and the members it goes to; only members who may read analytics
 * are taken, and each is read again before every send. The report runs through `runReport()` alone, for its own period as of the day it is
 * sent, and the email carries its first rows and the whole table as a CSV.
 */

export type ReportSchedule = {
  id: string;
  reportId: string;
  reportTitle: string;
  frequency: ReportFrequency;
  weekday: number | null;
  monthDay: number | null;
  hour: number;
  recipients: string[];
  enabled: boolean;
  lastRunOn: string | null;
};

export type ScheduleOutcome = { ok: true; id: string } | { ok: false; problem: ScheduleProblem | "too_many" | "gone" };

/** The store's members who may read analytics: who a schedule may go to. */
export async function reportRecipients(storeId: string): Promise<{ accountId: string; name: string | null; email: string; lang: AdminLang }[]> {
  const rows = await db().execute<Record<string, unknown>>(sql`
    select distinct on (a.id) a.id, a.email, a.name, a.admin_locale, m.role = 'owner' as owner, m.kind, m.role_id, r.permissions
    from commerce.store_members m
    join commerce.accounts a on a.id = m.account_id and a.disabled_at is null
    left join commerce.store_roles r on r.store_id = m.store_id and r.id = m.role_id
    where m.store_id = ${storeId}::uuid and m.disabled_at is null and (m.expires_at is null or m.expires_at > now()) and a.email <> ''
    order by a.id, (m.role = 'owner') desc
  `);
  return rows.flatMap((r) => {
    const permissions = permissionsOf({
      role: r.owner ? "owner" : "admin",
      kind: r.kind === "collaborator" ? "collaborator" : "staff",
      permissions: r.role_id ? ((r.permissions ?? []) as string[]).map(String) : null,
    });
    if (!permissions.includes("analytics:read") && !permissions.includes("analytics:write")) return [];
    return [{ accountId: String(r.id), name: r.name ? String(r.name) : null, email: String(r.email), lang: adminLangOf(r.admin_locale ? String(r.admin_locale) : null) }];
  });
}

const scheduleRow = z.object({
  id: col.uuid,
  report_id: col.uuid,
  title: col.text,
  frequency: z.enum(["daily", "weekly", "monthly"]),
  weekday: col.int.nullable(),
  month_day: col.int.nullable(),
  hour: col.int,
  recipients: z.array(z.string()),
  enabled: z.boolean(),
  last_run_on: col.text.nullable(),
});

const asSchedule = (r: z.output<typeof scheduleRow>): ReportSchedule => ({
  id: r.id,
  reportId: r.report_id,
  reportTitle: r.title,
  frequency: r.frequency,
  weekday: r.weekday,
  monthDay: r.month_day,
  hour: r.hour,
  recipients: r.recipients,
  enabled: r.enabled,
  lastRunOn: r.last_run_on,
});

/** The store's schedules, each with its report's name. */
export async function listReportSchedules(storeId: string): Promise<ReportSchedule[]> {
  const rows = await typedRows(scheduleRow, sql`
    select s.id, s.report_id, r.title, s.frequency, s.weekday, s.month_day, s.hour, s.recipients::text[] as recipients, s.enabled, s.last_run_on::text
    from commerce.report_schedules s join commerce.saved_reports r on r.store_id = s.store_id and r.id = s.report_id
    where s.store_id = ${storeId}::uuid order by lower(r.title), s.created_at
  `);
  return rows.map(asSchedule);
}

/**
 * Saves a schedule: a new one without `id`, else the store's own. The report must be the store's own saved report, every recipient a member
 * who may read analytics, and a store keeps at most `REPORT_SCHEDULES_MAX`. Audited with the report and the counts, never the addresses.
 */
export async function saveReportSchedule(storeId: string, accountId: string, raw: unknown, id?: string): Promise<ScheduleOutcome> {
  const read = readScheduleInput(raw);
  if (!read.ok) return read;
  const input = read.input;
  if (!(await getSavedReport(storeId, input.reportId))) return { ok: false, problem: "report" };
  const allowed = new Set((await reportRecipients(storeId)).map((m) => m.accountId));
  if (input.recipients.some((r) => !allowed.has(r))) return { ok: false, problem: "recipients" };
  const recipients = `{${input.recipients.join(",")}}`;
  if (id !== undefined) {
    if (!z.uuid().safeParse(id).success) return { ok: false, problem: "gone" };
    const changed = await db().execute(sql`
      update commerce.report_schedules set report_id = ${input.reportId}::uuid, frequency = ${input.frequency}, weekday = ${input.weekday},
        month_day = ${input.monthDay}, hour = ${input.hour}, recipients = ${recipients}::uuid[], enabled = ${input.enabled},
        updated_by = ${accountId}::uuid, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${id}::uuid returning id
    `);
    if (changed.length === 0) return { ok: false, problem: "gone" };
    await audit(accountId, storeId, "analytics.report_schedule_saved", { schedule: id, report: input.reportId, frequency: input.frequency, recipients: input.recipients.length }, { area: "analytics" });
    return { ok: true, id };
  }
  const [made] = await db().execute<Record<string, unknown>>(sql`
    insert into commerce.report_schedules (store_id, report_id, frequency, weekday, month_day, hour, recipients, enabled, created_by, updated_by)
    select ${storeId}::uuid, ${input.reportId}::uuid, ${input.frequency}, ${input.weekday}, ${input.monthDay}, ${input.hour}, ${recipients}::uuid[],
      ${input.enabled}, ${accountId}::uuid, ${accountId}::uuid
    where (select count(*) from commerce.report_schedules where store_id = ${storeId}::uuid) < ${REPORT_SCHEDULES_MAX}
    returning id
  `);
  if (!made) return { ok: false, problem: "too_many" };
  const madeId = String(made.id);
  await audit(accountId, storeId, "analytics.report_schedule_saved", { schedule: madeId, report: input.reportId, frequency: input.frequency, recipients: input.recipients.length }, { area: "analytics" });
  return { ok: true, id: madeId };
}

/** Stops a schedule; false when it is not the store's. */
export async function deleteReportSchedule(storeId: string, accountId: string, id: string): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const gone = await db().execute(sql`delete from commerce.report_schedules where store_id = ${storeId}::uuid and id = ${id}::uuid returning id`);
  if (gone.length === 0) return false;
  await audit(accountId, storeId, "analytics.report_schedule_deleted", { schedule: id }, { area: "analytics" });
  return true;
}

// ---------------------------------------------------------------------------
// The email
// ---------------------------------------------------------------------------

const cell = (metric: MetricKey, value: number | null | undefined, report: ReportResult, locale: string, notKnown: string) =>
  value === null || value === undefined ? notKnown : METRICS[metric].kind === "count" ? formatNumber(value) : formatAmount(value, report.currency, locale);

const valuesText = (report: ReportResult, values: ReportValues, locale: string, words: CustomReportsMessages) =>
  report.spec.metrics.map((m) => `${words.catalogue.metrics[m]}: ${cell(m, values[m], report, locale, words.result.noProfit)}`).join(" · ");

/** A saved report's email, in the recipient's admin language: its first rows, the total, what is left to the file, and a link to it. */
export function reportEmail(
  store: EmailStore & { slug: string },
  title: string,
  report: ReportResult,
  labels: Awaited<ReturnType<typeof reportLabels>>,
  lang: AdminLang,
): RenderedEmail {
  const words = adminText(lang, "customReports");
  const w = words.email;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const rows = report.rows.slice(0, REPORT_EMAIL_ROWS);
  const more = report.rows.length - rows.length + report.hiddenRows;
  const blocks: EmailBlock[] = [
    { type: "heading", text: title },
    { type: "paragraph", text: fillWords(w.intro, { report: title, period: report.period.label, currency: report.currency }) },
  ];
  if (report.rows.length === 0) blocks.push({ type: "paragraph", text: w.empty });
  if (rows.length > 0 && report.spec.dimensions.length > 0) {
    blocks.push({
      type: "lines",
      rows: rows.map((row) => ({
        label: report.spec.dimensions.map((d, i) => labelOf(labels, d, row.keys[i])).join(" · "),
        value: valuesText(report, row.values, locale, words),
      })),
    });
  }
  blocks.push({ type: "lines", rows: [{ label: words.result.total, value: valuesText(report, report.totals.values, locale, words), strong: true }] });
  if (more > 0) blocks.push({ type: "paragraph", text: countWords(more, w.more) });
  // What the figures leave out, said as the report's page says it.
  if (report.unconverted > 0) blocks.push({ type: "paragraph", text: countWords(report.unconverted, words.result.unconverted, { currencies: report.missingCurrencies.join(", ") }) });
  if (report.spec.metrics.includes("gross_profit")) {
    const coverage = report.totals.coverage;
    if (report.totals.values.gross_profit === null) blocks.push({ type: "paragraph", text: words.result.noProfitHelp });
    else if (coverage !== null && coverage < 1) blocks.push({ type: "paragraph", text: fillWords(words.result.coverage, { share: formatPercent(coverage, 0) }) });
  }
  blocks.push({ type: "button", text: w.open, url: `${siteUrl()}${reportLink(store.slug, report.spec)}` });
  blocks.push({ type: "paragraph", text: w.why });
  return renderEmail({
    subject: fillWords(w.subject, { report: title, store: store.name }),
    preview: fillWords(w.preview, { period: report.period.label }),
    lang: ADMIN_LANG_FACTS[lang].tag,
    footer: emailFooter(store, emailText(lang)),
    blocks,
  });
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

const dueRow = z.object({
  id: col.uuid,
  store_id: col.uuid,
  slug: col.text,
  time_zone: col.text.nullable(),
  report_id: col.uuid,
  frequency: z.enum(["daily", "weekly", "monthly"]),
  weekday: col.int.nullable(),
  month_day: col.int.nullable(),
  hour: col.int,
  recipients: z.array(z.string()),
  enabled: z.boolean(),
  last_run_on: col.text.nullable(),
});

/**
 * Sends the reports that are due (the five-minute dispatcher): for each enabled schedule of an open store whose day and hour have come on the
 * store's clock and that has not run today, the day is claimed first (`last_run_on`), the report runs once, and each recipient who is still a
 * member who may read analytics gets it in their own language, once (keyed by schedule, day and account). Never throws.
 */
export async function sendScheduledReports(options: { now?: Date; send?: typeof sendEmail } = {}): Promise<{ schedules: number; emails: number }> {
  const now = options.now ?? new Date();
  const send = options.send ?? sendEmail;
  const out = { schedules: 0, emails: 0 };
  let rows: z.output<typeof dueRow>[];
  try {
    rows = await typedRows(dueRow, sql`
      select s.id, s.store_id, st.slug, st.time_zone, s.report_id, s.frequency, s.weekday, s.month_day, s.hour, s.recipients::text[] as recipients,
        s.enabled, s.last_run_on::text
      from commerce.report_schedules s join commerce.stores st on st.id = s.store_id
      where s.enabled and commerce.store_is_active(s.store_id)
    `);
  } catch (error) {
    log("error", "report_schedules.read_failed", {}, error);
    return out;
  }
  for (const row of rows) {
    try {
      const local = localNow(now, row.time_zone ?? "Europe/Oslo");
      if (!scheduleDue({ ...row, monthDay: row.month_day, lastRunOn: row.last_run_on }, local)) continue;
      const claimed = await db().execute(sql`
        update commerce.report_schedules set last_run_on = ${local.date}::date
        where id = ${row.id}::uuid and last_run_on is distinct from ${local.date}::date returning id
      `);
      if (claimed.length === 0) continue;
      const [store, emailStore, saved] = await Promise.all([getStore(row.slug), storeById(row.store_id), getSavedReport(row.store_id, row.report_id)]);
      if (!store || !emailStore || !saved?.spec || saved.problems.length > 0) continue;
      const members = new Map((await reportRecipients(row.store_id)).map((m) => [m.accountId, m]));
      const targets = row.recipients.flatMap((id) => (members.has(id) ? [members.get(id)!] : []));
      if (targets.length === 0) continue;
      const outcome = await runReport(store, saved.spec, now);
      if (!outcome.ok) continue;
      const byLang = new Map<AdminLang, { email: RenderedEmail; csv: string }>();
      for (const target of targets) {
        if (!byLang.has(target.lang)) {
          const labels = await reportLabels(store, outcome.report, target.lang, ADMIN_LANG_FACTS[target.lang].locale);
          byLang.set(target.lang, { email: reportEmail({ ...emailStore, slug: store.slug }, saved.title, outcome.report, labels, target.lang), csv: reportCsv(outcome.report, labels) });
        }
        const made = byLang.get(target.lang)!;
        const result = await send({
          storeId: row.store_id,
          kind: "staff.report",
          to: target.email,
          email: made.email,
          fromName: emailStore.name,
          idempotencyKey: `report-schedule:${row.id}:${local.date}:${target.accountId}`,
          attachments: [{ filename: `report-${outcome.report.period.from}.csv`, content: made.csv, contentType: "text/csv; charset=utf-8" }],
        });
        if (result === "sent" || result === "logged") out.emails++;
      }
      out.schedules++;
    } catch (error) {
      log("error", "report_schedules.send_failed", { store: row.store_id, schedule: row.id }, error);
    }
  }
  return out;
}

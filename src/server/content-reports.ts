import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { storedReading, type AiReading } from "@/lib/content-moderation";
import {
  REPORT_CATEGORIES,
  REPORT_SENDER_MONTHS,
  reportHost,
  storeSlugFromUrl,
  type ReportCategory,
  type ReportInput,
  type ReportOutcome,
} from "@/lib/content-reports";
import { renderEmail } from "@/lib/email-layout";
import { PLATFORM_LANG_FACTS, type PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { siteUrl } from "@/lib/site";

import { audit, type Account } from "./auth";
import { sendEmail } from "./email";
import { log } from "./log";
import { col, typedRow, typedRows } from "./typed-rows";
import { normaliseEmail } from "@/lib/email-address";

/**
 * Notices of illegal content on a store (DSA art. 16, D411, `docs/dsa.md`): taken from the public form at `/report`, answered with a
 * receipt (art. 16(4)), put before Kaizena Flow's platform admins, decided by one of them with a reason, and the decision told to the
 * sender with the ways to have it reviewed (art. 16(5)) and, when something was restricted, to the store with its reasons (art. 17).
 * Nothing here decides by itself: an AI's reading (part 2, `src/server/content-moderation.ts`) sorts and drafts, a person decides, and
 * the emails then say automated means helped (`ai_used`).
 */

export type ContentReport = {
  id: string;
  url: string;
  category: ReportCategory;
  explanation: string;
  reporterName: string | null;
  reporterEmail: string | null;
  lang: PlatformLang;
  status: "received" | "actioned" | "no_action";
  decision: string | null;
  actionTaken: string | null;
  decidedAt: string | null;
  createdAt: string;
  store: { id: string; slug: string; name: string } | null;
  /** `notice` from `/report`, or `screening`, Kaizena Flow's own check of a listing (part 2). */
  source: "notice" | "screening";
  /** The AI's reading, shown beside the notice as the AI's; null until it read it, or without a model. */
  aiReading: AiReading | null;
};

const REPORT = z.object({
  id: col.uuid,
  url: col.text,
  category: z.enum(REPORT_CATEGORIES),
  explanation: col.text,
  reporter_name: col.textOrNull,
  reporter_email: col.textOrNull,
  lang: col.text,
  status: z.enum(["received", "actioned", "no_action"]),
  decision: col.textOrNull,
  action_taken: col.textOrNull,
  ai_used: col.bool,
  source: z.enum(["notice", "screening"]),
  ai_reading: z.unknown(),
  decided_at: col.timestampOrNull,
  created_at: col.timestamp,
  store_id: col.uuid.nullable(),
  store_slug: col.textOrNull,
  store_name: col.textOrNull,
});

const langOf = (value: string): PlatformLang => (value in PLATFORM_LANG_FACTS ? (value as PlatformLang) : "en");

const toReport = (row: z.output<typeof REPORT>): ContentReport => ({
  id: row.id,
  url: row.url,
  category: row.category,
  explanation: row.explanation,
  reporterName: row.reporter_name,
  reporterEmail: row.reporter_email,
  lang: langOf(row.lang),
  status: row.status,
  decision: row.decision,
  actionTaken: row.action_taken,
  decidedAt: row.decided_at,
  createdAt: row.created_at,
  store: row.store_id && row.store_slug ? { id: row.store_id, slug: row.store_slug, name: row.store_name ?? row.store_slug } : null,
  source: row.source,
  aiReading: storedReading(row.ai_reading),
});

const SELECT = sql`
  select r.id, r.url, r.category, r.explanation, r.reporter_name, r.reporter_email, r.lang, r.status, r.decision, r.action_taken,
    r.ai_used, r.source, r.ai_reading, r.decided_at, r.created_at, r.store_id, s.slug as store_slug, s.name as store_name
  from commerce.content_reports r left join commerce.stores s on s.id = r.store_id
`;

/** The store an address is on: a storefront path names it, a store's own domain is looked up; null for anything else. */
export async function storeOfUrl(url: string): Promise<string | null> {
  const slug = storeSlugFromUrl(url);
  const host = reportHost(url);
  const row = await typedRow(
    z.object({ id: col.uuid }),
    slug
      ? sql`select id from commerce.stores where slug = ${slug}`
      : sql`select store_id as id from commerce.store_domains where hostname = ${host ?? ""} or hostname = ${`www.${host ?? ""}`} limit 1`,
  );
  return row?.id ?? null;
}

/** Keeps a notice, answers the sender with a receipt and tells the platform admins. Returns the notice's id. */
export async function submitContentReport(input: ReportInput, lang: PlatformLang): Promise<string> {
  const storeId = await storeOfUrl(input.url);
  const name = input.name === "" ? null : input.name;
  const email = input.email === "" ? null : normaliseEmail(input.email);
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      insert into commerce.content_reports (store_id, url, category, explanation, reporter_name, reporter_email, good_faith, lang)
      values (${storeId}::uuid, ${input.url}, ${input.category}, ${input.explanation}, ${name}, ${email}, true, ${lang})
      returning id
    `,
  );
  if (!row) throw new Error("content report not kept");
  log("info", "content_report.received", { reportId: row.id, category: input.category, store: storeId !== null });

  // Art. 16(4): a receipt, without undue delay, when the sender gave an address; at most RECEIPTS_A_DAY to one address, so the form
  // cannot be used to send Kaizena Flow's mail to someone again and again (the notice itself is kept either way).
  if (email && (await receiptsToday(email)) <= RECEIPTS_A_DAY) {
    const w = platformText(lang).report.emails;
    const message = renderEmail({
      subject: w.receivedSubject,
      preview: w.receivedPreview,
      lang: PLATFORM_LANG_FACTS[lang].tag,
      footer: ["Kaizena Flow · kaizenaflow.com"],
      blocks: [
        { type: "heading", text: w.receivedSubject },
        { type: "paragraph", text: w.receivedBody },
        { type: "paragraph", text: `${w.addressLabel}: ${input.url}` },
        { type: "paragraph", text: `${w.referenceLabel}: ${row.id}` },
      ],
    });
    await sendEmail({ storeId: null, kind: "platform.content_report_received", to: email, email: message, fromName: "Kaizena Flow", idempotencyKey: `content-report-received:${row.id}` });
  }

  const admins = await typedRows(
    z.object({ id: col.uuid, email: col.text }),
    sql`select id, email from commerce.accounts where platform_admin and disabled_at is null and email <> ''`,
  );
  const alert = renderEmail({
    subject: "A notice of illegal content came in",
    preview: `A ${input.category.replaceAll("_", " ")} notice is waiting for a decision.`,
    lang: "en",
    footer: ["Kaizena Flow · kaizenaflow.com"],
    blocks: [
      { type: "heading", text: "A notice of illegal content came in" },
      { type: "paragraph", text: `Someone reported content as ${input.category.replaceAll("_", " ")}${storeId ? " on a store" : ""}. Decide it in a timely, diligent and objective way, and give the reason (DSA art. 16(6)).` },
      { type: "button", text: "Open the notices", url: `${siteUrl()}/admin/platform/reports` },
    ],
  });
  for (const admin of admins) {
    await sendEmail({ storeId: null, kind: "platform.content_report_new", to: admin.email, email: alert, fromName: "Kaizena Flow", idempotencyKey: `content-report-new:${row.id}:${admin.id}` });
  }
  return row.id;
}

/** How many receipts one address may get in a day. */
export const RECEIPTS_A_DAY = 3;

/** The notices given with this address in the last day, the one just kept included. */
async function receiptsToday(email: string): Promise<number> {
  const row = await typedRow(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.content_reports where reporter_email = ${email} and created_at > now() - interval '1 day'`,
  );
  return row?.n ?? 0;
}

/** Every notice, those waiting first (the ones the AI read as urgent first, then oldest first), then the decided ones (newest first). */
export async function listContentReports(limit = 200): Promise<ContentReport[]> {
  const rows = await typedRows(
    REPORT,
    sql`${SELECT} order by (r.status = 'received') desc, (r.status = 'received' and r.ai_reading ->> 'urgency' = 'high') desc,
      case when r.status = 'received' then r.created_at end asc, r.decided_at desc nulls last limit ${limit}`,
  );
  return rows.map(toReport);
}

export type Decision = { outcome: ReportOutcome; decision: string; actionTaken: string };
export type DecideProblem = "notFound" | "decided" | "reason" | "action";

/**
 * Decides a notice: records the outcome and its reason, audits it, tells the sender (art. 16(5)) and, when something was restricted on
 * a store, its owners with the statement of reasons (art. 17). What was restricted is done by the admin where it lives (the product or
 * page itself, or the store); this records what and why.
 */
export async function decideContentReport(admin: Account, id: string, input: Decision): Promise<{ ok: true } | { ok: false; problem: DecideProblem }> {
  const decision = input.decision.trim();
  const actionTaken = input.actionTaken.trim();
  if (decision.length < 10 || decision.length > 5000) return { ok: false, problem: "reason" };
  if (input.outcome === "actioned" && (actionTaken.length < 3 || actionTaken.length > 1000)) return { ok: false, problem: "action" };
  const updated = await typedRow(
    REPORT,
    sql`
      with done as (
        update commerce.content_reports set status = ${input.outcome}, decision = ${decision},
          action_taken = ${input.outcome === "actioned" ? actionTaken : null}, decided_at = now(), decided_by = ${admin.id}::uuid
        where id = ${id}::uuid and status = 'received'
        returning *
      )
      select r.id, r.url, r.category, r.explanation, r.reporter_name, r.reporter_email, r.lang, r.status, r.decision, r.action_taken,
        r.ai_used, r.source, r.ai_reading, r.decided_at, r.created_at, r.store_id, s.slug as store_slug, s.name as store_name
      from done r left join commerce.stores s on s.id = r.store_id
    `,
  );
  if (!updated) {
    const exists = await typedRow(z.object({ id: col.uuid }), sql`select id from commerce.content_reports where id = ${id}::uuid`);
    return { ok: false, problem: exists ? "decided" : "notFound" };
  }
  const report = toReport(updated);
  await audit(admin.id, report.store?.id ?? null, "platform.content_report_decided", { outcome: input.outcome, category: report.category }, { target: { type: "content_report", id } });
  log("info", "content_report.decided", { reportId: id, outcome: input.outcome });

  if (report.reporterEmail) {
    const w = platformText(report.lang).report.emails;
    const message = renderEmail({
      subject: w.decidedSubject,
      preview: input.outcome === "actioned" ? w.decidedActioned : w.decidedNoAction,
      lang: PLATFORM_LANG_FACTS[report.lang].tag,
      footer: ["Kaizena Flow · kaizenaflow.com"],
      blocks: [
        { type: "heading", text: w.decidedSubject },
        { type: "paragraph", text: `${w.addressLabel}: ${report.url}` },
        { type: "paragraph", text: input.outcome === "actioned" ? w.decidedActioned : w.decidedNoAction },
        ...(input.outcome === "actioned" ? [{ type: "paragraph" as const, text: `${w.actionLabel}: ${actionTaken}` }] : []),
        { type: "paragraph", text: `${w.reasonLabel}: ${decision}` },
        { type: "paragraph", text: updated.ai_used ? w.automatedUsed : w.automatedNone },
        { type: "paragraph", text: w.redress },
        { type: "paragraph", text: `${w.referenceLabel}: ${id}` },
      ],
    });
    await sendEmail({ storeId: null, kind: "platform.content_report_decided", to: report.reporterEmail, email: message, fromName: "Kaizena Flow", idempotencyKey: `content-report-decided:${id}` });
  }

  // Art. 17: the store whose content was restricted is told what, on what facts, on what ground, that a notice started it, and how to
  // have it reviewed. The sender's identity is left out (art. 17(3)(b) asks for it only where strictly necessary).
  if (input.outcome === "actioned" && report.store) {
    const owners = await typedRows(
      z.object({ id: col.uuid, email: col.text }),
      sql`
        select a.id, a.email from commerce.store_members m join commerce.accounts a on a.id = m.account_id
        where m.store_id = ${report.store.id}::uuid and m.role = 'owner' and a.disabled_at is null and a.email <> ''
      `,
    );
    const statement = renderEmail({
      subject: "Content on your store was restricted",
      preview: `After a notice, Kaizena Flow restricted content on ${report.store.name}.`,
      lang: "en",
      footer: ["Kaizena Flow · kaizenaflow.com"],
      blocks: [
        { type: "heading", text: "Content on your store was restricted" },
        { type: "paragraph", text: `What: ${actionTaken}` },
        { type: "paragraph", text: `Where: ${report.url}` },
        { type: "paragraph", text: `Why: ${decision}` },
        {
          type: "paragraph",
          text: `Ground: the content was reported as ${report.category.replaceAll("_", " ")} and found incompatible with the law or with Kaizena Flow's terms. ${
            report.source === "screening" ? "The decision followed Kaizena Flow's own check of the listing, which an AI made." : "The decision followed a notice from a third party."
          }`,
        },
        {
          type: "paragraph",
          text: updated.ai_used
            ? "Automated means were used: an AI helped sort and read it and drafted a reason. A person at Kaizena Flow checked it and took the decision."
            : "No automated means were used; a person at Kaizena Flow took the decision.",
        },
        {
          type: "paragraph",
          text: "If you disagree, reply to this email or write to Kaizena Flow's support: we will look at it again. You may also turn to an out-of-court dispute settlement body certified under the Digital Services Act, or to the courts.",
        },
        { type: "paragraph", text: `Reference: ${id}` },
      ],
    });
    for (const owner of owners) {
      await sendEmail({ storeId: report.store.id, kind: "platform.content_report_restricted", to: owner.email, email: statement, fromName: "Kaizena Flow", idempotencyKey: `content-report-restricted:${id}:${owner.id}` });
    }
  }
  return { ok: true };
}

/** Blanks the sender's name and address on notices decided more than `REPORT_SENDER_MONTHS` ago. Returns how many. */
export async function pruneContentReports(now: Date = new Date()): Promise<number> {
  const rows = await db().execute(sql`
    update commerce.content_reports set reporter_name = null, reporter_email = null
    where decided_at < ${now.toISOString()}::timestamptz - make_interval(months => ${REPORT_SENDER_MONTHS})
      and (reporter_name is not null or reporter_email is not null)
    returning id
  `);
  return rows.length;
}

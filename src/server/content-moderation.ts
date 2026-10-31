import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  SCREENING_SYSTEM,
  TRIAGE_SYSTEM,
  parseReading,
  parseScreening,
  screeningPrompt,
  triagePrompt,
  type AiReading,
  type Listing,
} from "@/lib/content-moderation";
import { renderEmail } from "@/lib/email-layout";
import { marketPath } from "@/lib/paths";
import { siteUrl } from "@/lib/site";

import { AiError, aiFor, completeText, type AiConnection } from "./ai";
import { audit, type Account } from "./auth";
import { sendEmail } from "./email";
import { log } from "./log";
import { getStore } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * AI in the handling of illegal content (DSA, D411 part 2, `docs/dsa.md`). The platform's model reads each notice beside the listing it
 * names and writes its reading (`content_reports.ai_reading`: category, urgency, whether manifestly illegal, a summary and a draft
 * reason); and, while a platform admin leaves it on, it reads new and changed listings for clear signs of illegal products and files a
 * flag in the same queue (source `screening`; art. 7, voluntary, never a general monitoring duty). It never decides: a person reads
 * the reading and decides each notice, and nothing is hidden by it. Without a model nothing changes: notices wait for a person as before.
 */

/** Notices read in one dispatcher run, and listings checked in one run: a cost cap of about 2,900 listings a day at most. */
export const TRIAGE_BATCH = 10;
export const SCREEN_BATCH = 10;

const OPTIONS = { maxTokens: 400, temperature: 0, reasoningEffort: "low" as const, timeoutMs: 30_000 };

const platformAi = () => aiFor(null, { feature: "content_moderation" });

async function ask(connection: AiConnection, system: string, prompt: string): Promise<string | null> {
  try {
    return (await completeText(connection, [{ role: "system", content: system }, { role: "user", content: prompt }], OPTIONS)).text;
  } catch (error) {
    if (error instanceof AiError) {
      log("warn", "content_moderation.ai_failed", { status: error.status ?? null });
      return null;
    }
    throw error;
  }
}

const LISTING = z.object({ title: col.text, description: col.text, safety: col.text });

/** A product's own words, in its first language (the model reads them; they are never shown from here). */
async function listingOf(productId: string): Promise<Listing | null> {
  return typedRow(
    LISTING,
    sql`
      select title, description, safety_information as safety from commerce.product_translations
      where product_id = ${productId}::uuid order by locale limit 1
    `,
  );
}

/** The listing a notice's address names: `/p/{handle}` on a store Kaizena Flow hosts; null for anything else. */
async function listingAt(storeId: string | null, url: string): Promise<Listing | null> {
  if (!storeId) return null;
  let handle: string | null = null;
  try {
    handle = /\/p\/([^/?#]+)/.exec(new URL(url).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
  if (!handle) return null;
  const product = await typedRow(
    z.object({ id: col.uuid }),
    sql`select id from commerce.products where store_id = ${storeId}::uuid and handle = ${decodeURIComponent(handle)} limit 1`,
  );
  return product ? listingOf(product.id) : null;
}

async function alertUrgent(reportId: string, reading: AiReading, screening: boolean) {
  const admins = await typedRows(
    z.object({ id: col.uuid, email: col.text }),
    sql`select id, email from commerce.accounts where platform_admin and disabled_at is null and email <> ''`,
  );
  const subject = screening ? "Urgent: Kaizena Flow's check flagged a listing" : "Urgent: a notice of illegal content needs a decision";
  const email = renderEmail({
    subject,
    preview: "The AI read it as urgent. A person decides.",
    lang: "en",
    footer: ["Kaizena Flow · kaizenaflow.com"],
    blocks: [
      { type: "heading", text: subject },
      { type: "paragraph", text: `The AI read it as ${reading.category.replaceAll("_", " ")} and urgent${reading.manifest ? ", and illegal on its face" : ""}. Its reading is beside the notice. Nothing has been hidden: decide it yourself.` },
      { type: "button", text: "Open the notices", url: `${siteUrl()}/admin/platform/reports` },
    ],
  });
  for (const admin of admins) {
    await sendEmail({ storeId: null, kind: "platform.content_report_urgent", to: admin.email, email, fromName: "Kaizena Flow", idempotencyKey: `content-report-urgent:${reportId}:${admin.id}` });
  }
}

export type TriageOutcome = "read" | "no_ai" | "unreadable" | "skipped";

/** Writes the AI's reading of a waiting notice, once; an urgent one emails the platform admins again. */
export async function triageContentReport(reportId: string): Promise<TriageOutcome> {
  const report = await typedRow(
    z.object({ url: col.text, category: col.text, explanation: col.text, store_id: col.uuid.nullable() }),
    sql`
      select url, category, explanation, store_id from commerce.content_reports
      where id = ${reportId}::uuid and status = 'received' and source = 'notice' and ai_reading is null
    `,
  );
  if (!report) return "skipped";
  const connection = await platformAi();
  if (!connection?.textModel) return "no_ai";
  const listing = await listingAt(report.store_id, report.url);
  const answer = await ask(connection, TRIAGE_SYSTEM, triagePrompt(report, listing));
  const reading = answer === null ? null : parseReading(answer);
  if (!reading) return "unreadable";
  const kept = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      update commerce.content_reports set ai_reading = ${JSON.stringify(reading)}::jsonb, ai_note = ${reading.summary}, ai_used = true
      where id = ${reportId}::uuid and status = 'received' and ai_reading is null returning id
    `,
  );
  if (!kept) return "skipped";
  log("info", "content_moderation.read", { reportId, urgency: reading.urgency, manifest: reading.manifest });
  if (reading.urgency === "high") await alertUrgent(reportId, reading, false);
  return "read";
}

/** Reads the notices still waiting without a reading (a notice is read at once after it is sent; this catches the ones that were not). */
export async function triageWaitingReports(limit = TRIAGE_BATCH): Promise<number> {
  const waiting = await typedRows(
    z.object({ id: col.uuid }),
    sql`
      select id from commerce.content_reports where status = 'received' and source = 'notice' and ai_reading is null
      order by created_at limit ${limit}
    `,
  );
  let read = 0;
  for (const { id } of waiting) {
    const outcome = await triageContentReport(id);
    if (outcome === "no_ai") break;
    if (outcome === "read") read += 1;
  }
  return read;
}

/** Whether Kaizena Flow's own check of listings runs (Platform → Notices; on unless a platform admin turned it off). */
export async function screeningOn(): Promise<boolean> {
  const row = await typedRow(z.object({ on: col.bool }), sql`select coalesce((select content_screening from commerce.platform_settings limit 1), true) as on`);
  return row?.on ?? true;
}

/** Turns the check on or off, audited (the platform admin's alone). */
export async function setScreening(admin: Account, on: boolean): Promise<void> {
  await db().execute(sql`
    insert into commerce.platform_settings (id, content_screening) values (true, ${on})
    on conflict (id) do update set content_screening = excluded.content_screening
  `);
  await audit(admin.id, null, "platform.content_screening", { on });
}

/** A product's public address in its store's main market, or the store's own address when that cannot be made. */
async function productUrl(storeSlug: string, handle: string): Promise<string> {
  const absolute = (path: string) => (/^https?:\/\//.test(path) ? path : `${siteUrl()}${path}`);
  try {
    const store = await getStore(storeSlug);
    const market = store?.markets[0];
    if (market) return absolute(marketPath(storeSlug, market.slug, `/p/${encodeURIComponent(handle)}`));
  } catch (error) {
    log("warn", "content_moderation.url_failed", {}, error);
  }
  return `${siteUrl()}/s/${storeSlug}`;
}

const CANDIDATE = z.object({
  product_id: col.uuid,
  store_id: col.uuid,
  store_slug: col.text,
  handle: col.text,
  hash: col.text,
  title: col.text,
  description: col.text,
  safety: col.text,
});

/**
 * Kaizena Flow's own check of listings (art. 7): active products of live stores whose words are new or changed since they were last
 * read, up to `SCREEN_BATCH`; each read once per wording (`content_screened`). A clear sign files a flag for a person in the notices'
 * queue, at most one open flag per product. Returns how many were read.
 */
export async function screenListings(limit = SCREEN_BATCH, only: { storeId?: string } = {}): Promise<number> {
  if (!(await screeningOn())) return 0;
  const connection = await platformAi();
  if (!connection?.textModel) return 0;
  const candidates = await typedRows(
    CANDIDATE,
    sql`
      with words as (
        select distinct on (t.product_id) t.product_id, t.title, t.description, t.safety_information as safety
        from commerce.product_translations t order by t.product_id, t.locale
      )
      select p.id as product_id, p.store_id, s.slug as store_slug, p.handle, w.title, w.description, w.safety,
        md5(w.title || E'\\n' || w.description || E'\\n' || w.safety) as hash
      from commerce.products p
      join commerce.stores s on s.id = p.store_id and not s.starter and s.closed_at is null
      join words w on w.product_id = p.id
      left join commerce.content_screened c on c.product_id = p.id
      where p.status = 'active' ${only.storeId ? sql`and p.store_id = ${only.storeId}::uuid` : sql``}
        and (c.product_id is null or c.content_hash <> md5(w.title || E'\\n' || w.description || E'\\n' || w.safety))
      order by c.screened_at nulls first, p.id
      limit ${limit}
    `,
  );
  let read = 0;
  for (const item of candidates) {
    const answer = await ask(connection, SCREENING_SYSTEM, screeningPrompt({ title: item.title, description: item.description, safety: item.safety }));
    const result = answer === null ? null : parseScreening(answer);
    // An unreadable answer leaves the product to be read again next time.
    if (!result) continue;
    read += 1;
    await db().execute(sql`
      insert into commerce.content_screened (product_id, store_id, content_hash, flagged, screened_at)
      values (${item.product_id}::uuid, ${item.store_id}::uuid, ${item.hash}, ${result.flag}, now())
      on conflict (product_id) do update set content_hash = excluded.content_hash, flagged = excluded.flagged, screened_at = now()
    `);
    if (!result.flag) continue;
    const open = await typedRow(
      z.object({ id: col.uuid }),
      sql`select id from commerce.content_reports where product_id = ${item.product_id}::uuid and status = 'received' limit 1`,
    );
    if (open) continue;
    const { reading } = result;
    const flag = await typedRow(
      z.object({ id: col.uuid }),
      sql`
        insert into commerce.content_reports (store_id, product_id, url, category, explanation, good_faith, source, ai_used, ai_reading, ai_note)
        values (${item.store_id}::uuid, ${item.product_id}::uuid, ${await productUrl(item.store_slug, item.handle)}, ${reading.category},
          ${`Kaizena Flow's own check of this listing (DSA art. 7) found a sign of illegal content: ${reading.summary}`.slice(0, 5000)},
          true, 'screening', true, ${JSON.stringify(reading)}::jsonb, ${reading.summary})
        returning id
      `,
    );
    if (!flag) continue;
    log("info", "content_moderation.flagged", { reportId: flag.id, urgency: reading.urgency });
    if (reading.urgency === "high") await alertUrgent(flag.id, reading, true);
  }
  return read;
}

/** The dispatcher's job: notices without a reading first, then the listings' check. */
export async function runContentModeration(): Promise<{ read: number; screened: number }> {
  const read = await triageWaitingReports();
  const screened = await screenListings();
  return { read, screened };
}


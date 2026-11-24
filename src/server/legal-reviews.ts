import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";

import { LEGAL_VIEW_MAX, legalReviewOf } from "@/lib/legal-reviews";
import { mayReadLegalReviews } from "@/lib/platform-access";

import { audit, requireAccount, type Account } from "./auth";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Legal reviews (D892): the drafts an outside lawyer reads (`LEGAL_REVIEWS`) and the views they write on each point, kept as records in
 * `platform_legal_views`. Open to the platform's owners and its lawyers (`mayReadLegalReviews()`), never to the platform's other roles.
 */

/** The signed-in account when it may open Legal reviews, else a 404. */
export async function requireLegalReader(): Promise<Account> {
  const account = await requireAccount();
  if (!mayReadLegalReviews(account)) notFound();
  return account;
}

/**
 * A review's document as the repository keeps it. Each file is named by a literal, so the build traces only these files into the route
 * (`outputFileTracingIncludes` in `next.config.ts`), never the whole folder.
 */
const TEXTS: Record<string, () => string> = {
  "outreach-rules": () => readFileSync(path.join(process.cwd(), "docs/outreach-rules.md"), "utf8"),
};

export function reviewText(slug: string): string | null {
  const read = TEXTS[slug];
  return read ? read() : null;
}

export type LegalView = { item: string; view: string; at: string; by: string; earlier: number };

/** The newest view on each point of a review, with who wrote it, when, and how many it replaced. */
export async function latestViews(slug: string): Promise<LegalView[]> {
  const rows = await typedRows(
    z.object({ item: col.text, view: col.text, at: col.timestamp, by: col.textOrNull, earlier: col.int }),
    sql`
      select distinct on (v.item) v.item, v.view, v.created_at as at, coalesce(nullif(a.name, ''), a.email) as by,
             (count(*) over (partition by v.item))::int - 1 as earlier
        from commerce.platform_legal_views v left join commerce.accounts a on a.id = v.account_id
       where v.review = ${slug}
       order by v.item, v.created_at desc, v.id desc`,
  );
  return rows.map((r) => ({ item: r.item, view: r.view, at: new Date(r.at).toISOString(), by: r.by ?? "", earlier: r.earlier }));
}

export type SaveViewResult = { ok: true } | { ok: false; problem: "missing" | "empty" | "long" };

/** Keeps a view on one point of a review, as a new record. Only an owner or a lawyer of the platform. */
export async function saveView(account: Account, slug: string, item: string, raw: string): Promise<SaveViewResult> {
  if (!mayReadLegalReviews(account)) return { ok: false, problem: "missing" };
  const review = legalReviewOf(slug);
  if (!review || !review.items.some((i) => i.key === item)) return { ok: false, problem: "missing" };
  const view = raw.replace(/\r\n/g, "\n").trim();
  if (!view) return { ok: false, problem: "empty" };
  if (view.length > LEGAL_VIEW_MAX) return { ok: false, problem: "long" };
  const saved = await typedRow(
    z.object({ id: col.uuid }),
    sql`insert into commerce.platform_legal_views (review, item, view, account_id) values (${slug}, ${item}, ${view}, ${account.id}::uuid) returning id`,
  );
  await audit(account.id, null, "platform.legal_view_saved", { review: slug, item }, saved ? { target: { type: "legal_view", id: saved.id } } : undefined);
  return { ok: true };
}

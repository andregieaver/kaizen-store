import "server-only";

import { createHash, createHmac } from "node:crypto";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { db, readDb, type Db } from "@/db/client";
import {
  cleanComment,
  commentOutcome,
  commentProblems,
  COMMENTS_PER_STORE_HOUR,
  COMMENTS_PER_VISITOR_HOUR,
  normalisedBody,
  REFUSED_COMMENT_DAYS,
  REPEAT_HOURS,
  spamReasons,
  statusOf,
  type CommentAnswer,
  type CommentStatus,
  type Moderation,
  type SpamReason,
} from "@/lib/blog-comments";
import { blogOfArticle } from "@/lib/blogs";
import { parsePageContent } from "@/lib/page-content";
import { parseKey } from "@/lib/secret-box";

import { audit, type Account } from "./auth";
import { storeBlogs } from "./blogs";
import { textList } from "./sql-arrays";
import { log } from "./log";
import { refreshTagNow } from "./refresh";
import { resolveShop } from "./shop";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";
import { normaliseEmail } from "@/lib/email-address";

/**
 * Visitors' comments on a store's articles (wave 7 unit G, D341, decision 3): the only writer of `commerce.blog_comments`. A comment is
 * posted through `/api/blog/comments` (no cookie, the site's own pages only), counted against the visitor's and the store's hourly limits in
 * `commerce.chat_usage` under a keyed hash of the visitor's address (never the address), checked for spam in code (`spamReasons()`), and
 * kept as `commentOutcome()` says: waiting for staff (the default), shown at once (`automatic`), or marked as spam. Only approved comments
 * are ever shown (`approvedComments()`, cached under `commentsTag()`). Staff decide on the Comments page; the AI manager proposes the same
 * decisions for the owner's yes. Comments are personal data (D162): `commentsOf()` exports a person's, `eraseComments()` deletes them,
 * `pruneRefusedComments()` deletes refused ones after `REFUSED_COMMENT_DAYS`.
 */

/** Refreshed when a comment is shown or taken away; the article pages read approved comments under it. */
export const commentsTag = (storeId: string) => `blog-comments:${storeId}`;

/** Comments an article shows at most, oldest first. */
export const SHOWN_MAX = 200;

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export const bodyHash = (body: string): string => hash(normalisedBody(body)).slice(0, 40);

/** The visitor's bucket for a store: a keyed hash of their address and the store, never the address (a plain hash without the key, in tests). */
export function visitorBucket(address: string, storeId: string, env: string | undefined = process.env.SETTINGS_ENCRYPTION_KEY): string {
  const key = parseKey(env);
  const digest = key
    ? createHmac("sha256", createHmac("sha256", key).update("kaizen:blog-comments").digest()).update(`${storeId}|${address}`).digest("hex")
    : hash(`kaizen:blog-comments|${storeId}|${address}`);
  return `comment:${digest.slice(0, 32)}`;
}

const HOUR = sql`date_trunc('hour', now())`;

/** Takes one of a bucket's sends this hour, atomically; false when the hour's are used. */
async function takeSlot(executor: Executor, storeId: string, bucket: string, limit: number): Promise<boolean> {
  const row = await typedRow(z.object({ count: col.int }), sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count) values (${storeId}::uuid, ${bucket}, ${HOUR}, 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `, executor);
  return (row?.count ?? 0) <= limit;
}

export type CommentPost = {
  store: string;
  market: string;
  /** The article's id. */
  article: string;
  name: string;
  email: string;
  body: string;
  /** The field people never see. */
  website: string;
  /** Milliseconds from showing the form to sending it. */
  elapsed: number;
};

/** A visitor's comment: checked, counted, checked for spam, and kept as the blog's setting says. The answer never says why one was held. */
export async function postComment(post: CommentPost, visitorAddress: string): Promise<{ status: number; body: CommentAnswer }> {
  const shop = await resolveShop(post.store, post.market);
  if (!shop) return { status: 404, body: { ok: false, error: "failed" } };
  const { store, market } = shop;
  const page = await typedRow(z.object({ published: z.unknown() }), sql`
    select published from commerce.pages
    where id = ${post.article}::uuid and store_id = ${store.id}::uuid and type = 'article' and published_at is not null
  `);
  const content = page ? parsePageContent(page.published) : null;
  if (!content) return { status: 404, body: { ok: false, error: "failed" } };
  const blog = blogOfArticle(await storeBlogs(store.id), content);
  if (!blog || blog.comments === "off") return { status: 403, body: { ok: false, error: "closed" } };

  const problems = commentProblems(post);
  if (Object.keys(problems).length > 0) return { status: 422, body: { ok: false, error: "invalid", problems } };
  const comment = cleanComment(post);
  const key = bodyHash(comment.body);

  try {
    return await db().transaction(async (tx): Promise<{ status: number; body: CommentAnswer }> => {
      // A robot that filled the hidden field is told it worked; nothing is kept or counted.
      const first = spamReasons({ name: comment.name, body: comment.body, website: post.website, elapsedMs: post.elapsed, repeated: false });
      if (first.includes("honeypot")) return { status: 200, body: { ok: true, shown: false } };
      const visitorOk = await takeSlot(tx, store.id, visitorBucket(visitorAddress, store.id), COMMENTS_PER_VISITOR_HOUR);
      const storeOk = await takeSlot(tx, store.id, "comments", COMMENTS_PER_STORE_HOUR);
      if (!visitorOk || !storeOk) return { status: 429, body: { ok: false, error: "busy" } };
      const again = await typedRow(z.object({ found: col.bool }), sql`
        select exists (
          select 1 from commerce.blog_comments where store_id = ${store.id}::uuid and body_hash = ${key}
            and created_at > now() - make_interval(hours => ${REPEAT_HOURS})
        ) as found
      `, tx);
      const reasons = spamReasons({ name: comment.name, body: comment.body, website: post.website, elapsedMs: post.elapsed, repeated: Boolean(again?.found) });
      const outcome = commentOutcome(blog.comments, reasons);
      if (outcome.kind !== "kept") return { status: 200, body: { ok: true, shown: false } };
      await tx.execute(sql`
        insert into commerce.blog_comments (store_id, page_id, name, email, body, body_hash, locale, status, spam_reasons)
        values (${store.id}::uuid, ${post.article}::uuid, ${comment.name}, ${comment.email || null}, ${comment.body}, ${key}, ${market.locale},
          ${outcome.status}, ${textList(reasons)})
      `);
      log("info", "blog_comment.posted", { store: store.id, status: outcome.status, reasons: reasons.length });
      return { status: 200, body: { ok: true, shown: outcome.status === "approved" } };
    }).then((result) => {
      // A comment shown at once (`automatic`): the article's page is drawn again with it on the visitor's next look.
      if (result.status === 200 && result.body.ok && result.body.shown) refreshTagNow(commentsTag(store.id));
      return result;
    });
  } catch (error) {
    log("error", "blog_comment.failed", { store: store.id }, error);
    return { status: 500, body: { ok: false, error: "failed" } };
  }
}

export type ShownComment = { id: string; name: string; body: string; createdAt: string };

/** An article's approved comments, oldest first: the only comments a visitor ever sees. Cached until one is decided or deleted. */
export async function approvedComments(storeId: string, pageId: string): Promise<ShownComment[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(commentsTag(storeId));
  const rows = await typedRows(
    z.object({ id: col.uuid, name: col.text, body: col.text, created_at: col.timestamp }),
    sql`
      select id, name, body, created_at from commerce.blog_comments
      where store_id = ${storeId}::uuid and page_id = ${pageId}::uuid and status = 'approved'
      order by created_at, id limit ${SHOWN_MAX}
    `,
    readDb(),
  );
  return rows.map((r) => ({ id: r.id, name: r.name, body: r.body, createdAt: r.created_at }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------------------------------------------------------------

export type StaffComment = {
  id: string;
  pageId: string;
  article: string;
  articleSlug: string;
  name: string;
  /** The email the visitor gave, for staff only; never shown on the site. */
  email: string | null;
  body: string;
  status: CommentStatus;
  spamReasons: SpamReason[];
  createdAt: string;
};

const staffRow = z.object({
  id: col.uuid,
  page_id: col.uuid,
  article: col.textOrNull,
  slug: col.text,
  name: col.text,
  email: col.textOrNull,
  body: col.text,
  status: z.enum(["pending", "approved", "rejected", "spam"]),
  spam_reasons: z.array(z.string()),
  created_at: col.timestamp,
});

/** The store's comments in one state (newest first), for the Comments page and the AI manager. */
export async function listComments(storeId: string, status: CommentStatus, limit = 100): Promise<StaffComment[]> {
  const rows = await typedRows(staffRow, sql`
    select c.id, c.page_id, p.draft ->> 'title' as article, p.slug, c.name, c.email, c.body, c.status, c.spam_reasons, c.created_at
    from commerce.blog_comments c join commerce.pages p on p.id = c.page_id and p.store_id = c.store_id
    where c.store_id = ${storeId}::uuid and c.status = ${status}
    order by c.created_at desc, c.id limit ${Math.max(1, Math.min(500, limit))}
  `);
  return rows.map((r) => ({
    id: r.id,
    pageId: r.page_id,
    article: r.article ?? r.slug,
    articleSlug: r.slug,
    name: r.name,
    email: r.email,
    body: r.body,
    status: r.status,
    spamReasons: r.spam_reasons.filter((s): s is SpamReason => ["honeypot", "too_fast", "links", "link_in_name", "repeated"].includes(s)),
    createdAt: r.created_at,
  }));
}

/** How many of the store's comments are in each state. */
export async function commentCounts(storeId: string): Promise<Record<CommentStatus, number>> {
  const rows = await typedRows(z.object({ status: col.text, n: col.int }), sql`
    select status, count(*)::int as n from commerce.blog_comments where store_id = ${storeId}::uuid group by status
  `);
  const counts: Record<CommentStatus, number> = { pending: 0, approved: 0, rejected: 0, spam: 0 };
  for (const row of rows) if (row.status in counts) counts[row.status as CommentStatus] = row.n;
  return counts;
}

/** Shows, refuses or marks as spam one of the store's comments. Audited with the comment's id and the decision, never its words. */
export async function moderateComment(account: Account, storeId: string, id: string, action: Moderation): Promise<boolean> {
  const status = statusOf(action);
  const rows = await db().execute(sql`
    update commerce.blog_comments set status = ${status}, decided_at = now(), decided_by = ${account.id}::uuid
    where id = ${id}::uuid and store_id = ${storeId}::uuid and status <> ${status}
    returning id
  `);
  if (rows.length === 0) return false;
  await audit(account.id, storeId, "store.article_comment_moderated", { comment: id, status }, { target: { type: "blog_comment", id } });
  return true;
}

/** Deletes one of the store's comments for good. */
export async function deleteComment(account: Account, storeId: string, id: string): Promise<boolean> {
  const rows = await db().execute(sql`delete from commerce.blog_comments where id = ${id}::uuid and store_id = ${storeId}::uuid returning id`);
  if (rows.length === 0) return false;
  await audit(account.id, storeId, "store.article_comment_deleted", { comment: id }, { target: { type: "blog_comment", id } });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Personal data (D162)
// ---------------------------------------------------------------------------------------------------------------------------------

export type CommentExportRow = { article: string; name: string; email: string | null; body: string; status: CommentStatus; postedAt: string };

/** A person's comments in a store, by their proven addresses (`resolveSubject()`), for the export's `comments` section. */
export async function commentsOf(storeId: string, emails: readonly string[]): Promise<CommentExportRow[]> {
  const lower = [...new Set(emails.map(normaliseEmail).filter(Boolean))];
  if (lower.length === 0) return [];
  const rows = await typedRows(
    z.object({ article: col.textOrNull, slug: col.text, name: col.text, email: col.textOrNull, body: col.text, status: z.enum(["pending", "approved", "rejected", "spam"]), created_at: col.timestamp }),
    sql`
      select p.published ->> 'title' as article, p.slug, c.name, c.email, c.body, c.status, c.created_at
      from commerce.blog_comments c join commerce.pages p on p.id = c.page_id and p.store_id = c.store_id
      where c.store_id = ${storeId}::uuid and lower(c.email) = any(${textList(lower)})
      order by c.created_at
    `,
  );
  return rows.map((r) => ({ article: r.article ?? r.slug, name: r.name, email: r.email, body: r.body, status: r.status, postedAt: r.created_at }));
}

/** How many comments a person's addresses wrote in a store (the erasure's preview). */
export async function countCommentsOf(executor: Executor, storeId: string, emails: readonly string[]): Promise<number> {
  const lower = [...new Set(emails.map(normaliseEmail).filter(Boolean))];
  if (lower.length === 0) return 0;
  const row = await typedRow(z.object({ n: col.int }), sql`
    select count(*)::int as n from commerce.blog_comments
    where store_id = ${storeId}::uuid and lower(email) = any(${textList(lower)})
  `, executor);
  return row?.n ?? 0;
}

/** Deletes a person's comments in a store (erasure): their words and name go; returns how many. */
export async function eraseComments(tx: Pick<Db, "execute">, storeId: string, emails: readonly string[]): Promise<number> {
  const lower = [...new Set(emails.map(normaliseEmail).filter(Boolean))];
  if (lower.length === 0) return 0;
  const rows = await tx.execute(sql`
    delete from commerce.blog_comments
    where store_id = ${storeId}::uuid and lower(email) = any(${textList(lower)})
    returning id
  `);
  return rows.length;
}

/** Rejected and spam comments older than the retention rule's days, deleted in batches (`runRetention()`'s `blog_comments` step). */
export async function pruneRefusedComments(cutoff: Date, batch: number): Promise<number> {
  const rows = await db().execute(sql`
    delete from commerce.blog_comments where id in (
      select id from commerce.blog_comments where status in ('rejected', 'spam') and created_at < ${cutoff.toISOString()}::timestamptz limit ${batch}
    ) returning id
  `);
  return rows.length;
}

export { REFUSED_COMMENT_DAYS };

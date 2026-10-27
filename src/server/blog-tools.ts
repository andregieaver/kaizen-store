import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { type CommentStatus } from "@/lib/blog-comments";
import { blogPath, blogTitle, feedPath } from "@/lib/blogs";
import { t } from "@/lib/i18n";
import type { OwnerToolInput } from "@/lib/owner-tools";
import { blockingIssues, pageIssues, themeSetsOf } from "@/lib/page-a11y";
import { localInstant } from "@/lib/follow-ups";
import { scheduleInstant, wallClock } from "@/lib/page-schedules";
import { marketUrl } from "@/lib/paths";

import type { Account } from "./auth";
import { commentCounts, commentsTag, listComments, moderateComment } from "./blog-comments";
import { articleCounts, blogsNow } from "./blogs";
import { runningTestOf } from "./experiment-admin";
import { OwnerToolError } from "./owner-tool-error";
import { cancelSchedule, scheduleOf, schedulePage } from "./page-schedules";
import { getPageForEdit } from "./pages";
import type { Store } from "./stores";
import { col, typedRow } from "./typed-rows";

/**
 * The AI manager's blogs (wave 7 unit G, D341): `list_blogs` and `blog_comments` read what the Blogs and Comments pages show;
 * `moderate_blog_comment` (gate `public`, never automatic: a person reads a visitor's words before they are shown) and `schedule_article`
 * (gate `public`) go through the pages' own writers. A comment's words and name never reach the model: they are a visitor's, and a person
 * reads them on the Comments page; the model sees which article, when, and what the spam check found.
 */

type Ctx = { account: Account; store: Store; invalidate?: (tag: string) => void };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const adminLink = (store: Store, path: string) => `/admin/${store.slug}/articles${path}`;

export async function listBlogsTool({ store }: Ctx) {
  const [blogs, counts, comments] = await Promise.all([blogsNow(store.id), articleCounts(store.id), commentCounts(store.id)]);
  const market = store.markets[0];
  const main = store.localization.locales[0];
  return {
    blogs: blogs.map((blog) => ({
      id: blog.id,
      name: blogTitle(blog, main ?? "en", main, t(market?.lang ?? "en").blog),
      first: blog.main,
      address: blogPath(blog),
      feed: market ? marketUrl(store.slug, market.slug, feedPath(blog)) : feedPath(blog),
      comments: { off: "off: no comment form", moderated: "held until a person approves them", automatic: "shown at once when they pass the spam check" }[blog.comments],
      articles: counts.get(blog.id) ?? 0,
    })),
    comments_waiting: comments.pending,
    admin: adminLink(store, "/blogs"),
  };
}

export async function blogCommentsTool({ store }: Ctx, input: OwnerToolInput<"blog_comments">) {
  const status = input.status as CommentStatus;
  const [counts, comments] = await Promise.all([commentCounts(store.id), listComments(store.id, status, input.limit)]);
  return {
    counts: { waiting: counts.pending, shown: counts.approved, spam: counts.spam, refused: counts.rejected },
    comments: comments.map((c) => ({
      id: c.id,
      article: c.article,
      posted_at: c.createdAt,
      length: c.body.length,
      spam_check: c.spamReasons.length > 0 ? c.spamReasons : "nothing found",
    })),
    note: "A comment's words and name are a visitor's: read them on the Comments page before approving one. Never approve a comment you have not been told about by the owner.",
    admin: adminLink(store, `/comments?status=${status}`),
  };
}

/** The comment the input names, if it is the store's. */
async function storeComment(store: Store, id: string) {
  return typedRow(z.object({ id: col.uuid, status: col.text }), sql`
    select id, status from commerce.blog_comments where id = ${id}::uuid and store_id = ${store.id}::uuid
  `);
}

export async function preflightModerateTool({ store }: Ctx, raw: Record<string, unknown>): Promise<void> {
  const input = raw as OwnerToolInput<"moderate_blog_comment">;
  if (!(await storeComment(store, input.comment))) fail("That comment is not one of this store's. Read blog_comments.");
}

export async function moderateBlogCommentTool(ctx: Ctx, input: OwnerToolInput<"moderate_blog_comment">) {
  const { store } = ctx;
  if (!(await storeComment(store, input.comment))) return fail("That comment is not one of this store's. Read blog_comments.");
  const changed = await moderateComment(ctx.account, store.id, input.comment, input.action);
  ctx.invalidate?.(commentsTag(store.id));
  return {
    done: !changed
      ? "The comment was already so."
      : input.action === "approve"
        ? "The comment is shown on its article."
        : input.action === "reject"
          ? "The comment is refused; it is deleted after 30 days."
          : "The comment is marked as spam; it is deleted after 30 days.",
    admin: adminLink(store, "/comments"),
  };
}

/** The article an input names: by id, or by its address. */
async function findArticle(store: Store, ref: string): Promise<string> {
  const row = await typedRow(z.object({ id: col.uuid }), sql`
    select id from commerce.pages where store_id = ${store.id}::uuid and type = 'article'
      and (id::text = ${ref} or slug = ${ref.replace(/^\/?(blog|blogs\/[a-z0-9-]+)\//, "")})
    limit 1
  `);
  return row ? row.id : fail(`No article "${ref}" in this store. Use list_pages with type article to find it.`);
}

/** The schedule an input asks for, checked as the editor's Schedule does: the time on the store's clock, no running test, nothing blocking. */
async function checkedSchedule(store: Store, input: OwnerToolInput<"schedule_article">): Promise<{ id: string; at: Date | null }> {
  const id = await findArticle(store, input.article);
  if (input.at === null) return { id, at: null };
  const local = localInstant(input.at, store.timeZone);
  if (local === null) return fail("Give the time as YYYY-MM-DD HH:MM on the store's clock.");
  const [day, time] = input.at.trim().split(/[ T]/);
  const at = scheduleInstant(day, time, store.timeZone, new Date());
  if (!at.ok) return fail(at.problem === "too_soon" ? "Choose a time a few minutes from now or later." : at.problem === "too_late" ? "Choose a time within a year." : "Give the time as YYYY-MM-DD HH:MM.");
  const page = await getPageForEdit(store.id, id, "article");
  if (!page) return fail("That article is gone.");
  if (await runningTestOf(store.id, id)) fail("This article is in a running A/B test: stop the test first.");
  const blocking = blockingIssues(pageIssues(page.draft, { theme: { sets: themeSetsOf(store.theme.settings) } }));
  if (blocking.length > 0) {
    fail(`The article has ${blocking.length === 1 ? "a problem" : `${blocking.length} problems`} to fix before it is published: ${blocking.slice(0, 6).map((i) => `${i.where}: ${i.message}`).join(" ")} Fix them with edit_page first.`);
  }
  return { id, at: at.at };
}

export async function preflightScheduleTool({ store }: Ctx, raw: Record<string, unknown>): Promise<void> {
  await checkedSchedule(store, raw as OwnerToolInput<"schedule_article">);
}

export async function scheduleArticleTool(ctx: Ctx, input: OwnerToolInput<"schedule_article">) {
  const { store } = ctx;
  const { id, at } = await checkedSchedule(store, input);
  if (at === null) {
    const cancelled = await cancelSchedule(ctx.account, store.id, id, "article");
    return { done: cancelled ? "The schedule is cancelled; the article stays a draft." : "The article had no schedule.", editor: adminLink(store, `/${id}`) };
  }
  const result = await schedulePage(ctx.account, store.id, id, "article", at);
  if (!result.ok) return fail(result.problem === "ab_test" ? "This article is in a running A/B test: stop the test first." : "That article is gone.");
  const state = await scheduleOf(store.id, id);
  const when = state.waiting ? wallClock(state.waiting.at, store.timeZone) : null;
  return {
    done: "The article is scheduled: its draft as it is then is published at that time (within five minutes after it), and not before.",
    publishes_at: when ? `${when.day} ${when.time} (${store.timeZone})` : null,
    editor: adminLink(store, `/${id}`),
  };
}

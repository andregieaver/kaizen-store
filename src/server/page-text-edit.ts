import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { applyBlockEdit, blockWords, inlineProblem, locateBlock, type BlockEdit } from "@/lib/inline-edit";
import { pageInput, parsePageContent, type PageContent, type PageType, type RichTextDoc } from "@/lib/page-content";

import { audit, getAccount, type Account } from "./auth";
import { runningTestOf } from "./experiment-admin";
import { pagesTag } from "./pages";
import { checkPageTypeAccess } from "./permissions";
import { refreshTag } from "./refresh";

/**
 * Editing a page's words on the live site (D192): signed-in staff who may change the website press a heading or a text on the page
 * they are looking at and type in it (`src/components/inline-edit/site-editor.tsx`), without opening the page builder. Only the words
 * of a heading or a rich text of the page's own change, in the page as visitors see it (what is published) and, where the draft still
 * has the same words there, in the draft too, so the next publish does not take them back; a draft that has other words for it is
 * left as it is, its builder having work in it. Everything the browser sends is checked again as the page builder's save does
 * (`pageInput`), and a page in a running A/B test is not changed.
 */

type Row = Record<string, unknown>;

/** Why an edit was not made: the status to answer with and words for the person. */
export type PageTextFailure = {
  ok: false;
  status: 400 | 403 | 404 | 409 | 422;
  code: "forbidden" | "not_found" | "not_published" | "running_test" | "refused" | "conflict" | "invalid";
  message: string;
};

const fail = (status: PageTextFailure["status"], code: PageTextFailure["code"], message: string): PageTextFailure => ({ ok: false, status, code, message });

const FORBIDDEN = fail(403, "forbidden", "You cannot edit this page.");
const runningTest = (name: string) => fail(409, "running_test", `This page is in the running A/B test "${name}". Changing it now would spoil its results: stop the test first.`);
const GONE = fail(404, "not_found", "This text is no longer on the page. Reload the page.");

/** The kinds of page whose words are edited in place: the ones the site draws with `PageArticle`. */
const EDITABLE_TYPES: readonly PageType[] = ["page", "article"];

/** A short fingerprint of a block's words, so a save can tell that they changed since they were read. */
export const revisionOf = (words: string): string => createHash("sha256").update(words).digest("hex").slice(0, 16);

/** The page as it is stored: unauthorised, only to find out whose it is and what kind. */
async function pageRow(page: string): Promise<Row | null> {
  const [row] = await db().execute<Row>(sql`select id, store_id, type from commerce.pages where id = ${page}::uuid`);
  return row ?? null;
}

/** Who may change this page's words: a platform admin for Kaizen's own pages, a member whose role can change the website for a store's. */
async function authorise(store: string | null, row: Row): Promise<{ account: Account; owner: string | null } | null> {
  const type = String(row.type) as PageType;
  if (!EDITABLE_TYPES.includes(type)) return null;
  if (store === null) {
    const account = await getAccount();
    return account?.platformAdmin && row.store_id === null ? { account, owner: null } : null;
  }
  const member = await checkPageTypeAccess(store, type, "write");
  return member && member.store.id === String(row.store_id) ? { account: member.account, owner: member.store.id } : null;
}

/** What the page shows now, and the words of one of its blocks to edit. */
export type PageTextRead =
  | { ok: true; kind: "heading"; text: string; rev: string }
  | { ok: true; kind: "richText"; doc: RichTextDoc; rev: string };

/** The words of a heading or a text of a published page, for the person who may change them. */
export async function readPageText(input: { store: string | null; page: string; block: string }): Promise<PageTextRead | PageTextFailure> {
  const row = await pageRow(input.page);
  if (!row) return GONE;
  const who = await authorise(input.store, row);
  if (!who) return FORBIDDEN;
  // Told before anything is typed, not after.
  const test = who.owner === null ? null : await runningTestOf(who.owner, input.page);
  if (test) return runningTest(test.name);
  const [live] = await db().execute<Row>(sql`select published from commerce.pages where id = ${input.page}::uuid`);
  const published = parsePageContent(live?.published);
  if (!published) return fail(409, "not_published", "This page is not published, so there is nothing live to edit. Use the page builder.");
  const problem = inlineProblem(published.rows, input.block);
  if (problem) return fail(422, "refused", problem);
  const { block } = locateBlock(published.rows, input.block)!;
  const rev = revisionOf(blockWords(block));
  return block.type === "heading" ? { ok: true, kind: "heading", text: block.text, rev } : { ok: true, kind: "richText", doc: (block as { doc: RichTextDoc }).doc, rev };
}

/**
 * Changes a block's words, for someone already allowed to (`savePageText()` asks). In one transaction under the page's lock: the live
 * page, and the draft too where it has the same words in that block; the write is refused when the words are no longer the ones that
 * were read (`rev`), when the page is not published, is in a running A/B test, or the result would not be a page the builder could save.
 */
export async function applyPageText(input: {
  account: Account;
  owner: string | null;
  page: string;
  block: string;
  rev: string;
  edit: BlockEdit;
}): Promise<{ ok: true; draftKept: boolean } | PageTextFailure> {
  const { account, owner, page, block, rev, edit } = input;
  if (owner !== null) {
    const test = await runningTestOf(owner, page);
    if (test) return runningTest(test.name);
  }
  const outcome = await db().transaction(async (tx): Promise<{ ok: true; draftKept: boolean; slug: string; title: string; type: PageType } | PageTextFailure> => {
    const [row] = await tx.execute<Row>(sql`
      select slug, type, draft, published from commerce.pages
      where id = ${page}::uuid and store_id is not distinct from ${owner}::uuid and type in ('page', 'article')
      for update
    `);
    if (!row) return GONE;
    const published = parsePageContent(row.published);
    if (!published) return fail(409, "not_published", "This page is not published, so there is nothing live to edit. Use the page builder.");
    const live = locateBlock(published.rows, block);
    if (!live) return GONE;
    if (revisionOf(blockWords(live.block)) !== rev) {
      return fail(409, "conflict", "This text was changed by someone else while you were editing it. Reload the page to see their version.");
    }
    const edited = applyBlockEdit(published, block, edit);
    if (!edited.ok) return fail(422, "refused", edited.problem);
    const checked = pageInput.safeParse(edited.content);
    if (!checked.success) return fail(422, "invalid", [...new Set(checked.error.issues.map((issue) => issue.message))].join(" "));
    const next: PageContent = checked.data;

    // The draft keeps its own work: it takes the words only where it still has the ones the page had.
    const draft = parsePageContent(row.draft);
    const draftBlock = draft ? locateBlock(draft.rows, block) : null;
    const follows = Boolean(draft && draftBlock && draftBlock.block.type === live.block.type && blockWords(draftBlock.block) === blockWords(live.block));
    let nextDraft: PageContent | null = null;
    if (draft && follows) {
      const drafted = applyBlockEdit(draft, block, edit);
      const rechecked = drafted.ok ? pageInput.safeParse(drafted.content) : null;
      nextDraft = rechecked?.success ? rechecked.data : null;
    }
    await tx.execute(sql`
      update commerce.pages set
        published = ${JSON.stringify(next)}::jsonb,
        draft = case when ${nextDraft !== null}::boolean then ${JSON.stringify(nextDraft ?? {})}::jsonb else draft end,
        updated_at = now(), updated_by = ${account.id}::uuid
      where id = ${page}::uuid
    `);
    return { ok: true, draftKept: draft !== null && nextDraft === null, slug: String(row.slug), title: next.title, type: String(row.type) as PageType };
  });
  if (!outcome.ok) return outcome;
  // Written down with where and what kind, never the words.
  await audit(
    account.id,
    owner,
    `${owner === null ? "platform" : "store"}.${outcome.type}_text_edited`,
    { label: outcome.title, page, slug: outcome.slug, block, kind: edit.kind, draftKept: outcome.draftKept },
    { target: { type: "page", id: page } },
  );
  // The storefront's cached pages, menus and grids that draw this page.
  refreshTag(pagesTag(owner));
  return { ok: true, draftKept: outcome.draftKept };
}

/** The same for the person asking: finds out whose page it is and whether they may change it. */
export async function savePageText(input: { store: string | null; page: string; block: string; rev: string; edit: BlockEdit }): Promise<{ ok: true; draftKept: boolean } | PageTextFailure> {
  const row = await pageRow(input.page);
  if (!row) return GONE;
  const who = await authorise(input.store, row);
  if (!who) return FORBIDDEN;
  return applyPageText({ account: who.account, owner: who.owner, page: input.page, block: input.block, rev: input.rev, edit: input.edit });
}

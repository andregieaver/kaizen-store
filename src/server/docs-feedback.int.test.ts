import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

const feedback = await import("./docs-feedback");
const { POST } = await import("@/app/api/docs/feedback/route");

/**
 * *Was this page helpful?* on the docs (D442) against a real database: a yes or no kept on a page the docs have, its sentence added once and
 * only within the hour, cleaned and refused when too long, nothing of the reader kept, the route's refusals, and the platform admin's list,
 * counts and removal.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const PAGE = "owners/getting-started/create-your-store";
let admin: { id: string };
const ids: string[] = [];

/** A request as a reader's browser on the docs sends it: from the same host, with a fresh address each time so the budget stays clear. */
let visitor = 0;
const ask = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://localhost:3000/api/docs/feedback", {
      method: "POST",
      headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": `198.51.100.${(visitor++ % 250) + 1}-${run}`, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  const [a] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`docs-admin-${run}@example.com`}, 'Platform', true) returning id`);
  admin = { id: String(a.id) };
});

afterAll(async () => {
  for (const id of ids) await db().execute(sql`delete from commerce.docs_feedback where id = ${id}::uuid`);
  await closeDb();
});

describe("the docs' feedback (D442)", () => {
  it("keeps a yes or no on a page the docs have, and adds its sentence once, cleaned", async () => {
    const vote = await ask({ path: PAGE, lang: "en", helpful: false });
    expect(vote.status).toBe(201);
    const { id } = (await vote.json()) as { id: string };
    ids.push(id);
    const added = await ask({ id, comment: `  Step 5 lost me.​ ${run}\r\n` });
    expect(added.status).toBe(200);
    const [row] = await db().execute<Row>(sql`select path, lang, helpful, comment from commerce.docs_feedback where id = ${id}::uuid`);
    expect(row).toEqual({ path: PAGE, lang: "en", helpful: false, comment: `Step 5 lost me. ${run}` });
    // Only once: a second sentence finds nothing to add to.
    expect((await ask({ id, comment: "Again." })).status).toBe(404);
    // The table holds nothing about the reader.
    const columns = await db().execute<Row>(sql`select column_name from information_schema.columns where table_schema = 'commerce' and table_name = 'docs_feedback' order by ordinal_position`);
    expect(columns.map((c) => c.column_name)).toEqual(["id", "path", "lang", "helpful", "comment", "created_at"]);
  });

  it("keeps a Norwegian answer on a Norwegian page, and refuses a page the docs do not have in that language", async () => {
    const nb = await ask({ path: PAGE, lang: "nb", helpful: true });
    expect(nb.status).toBe(201);
    ids.push(((await nb.json()) as { id: string }).id);
    expect((await ask({ path: "owners/getting-started/nowhere", lang: "en", helpful: true })).status).toBe(404);
    expect((await ask({ path: "developers/overview/introduction", lang: "nb", helpful: true })).status).toBe(404);
  });

  it("keeps an answer on a page of the generated reference (E4), in English, the reference's one language", async () => {
    const reference = await ask({ path: "reference/admin-api/products", lang: "en", helpful: false });
    expect(reference.status).toBe(201);
    ids.push(((await reference.json()) as { id: string }).id);
    expect((await ask({ path: "reference/admin-api/products", lang: "nb", helpful: true })).status).toBe(404);
    expect((await ask({ path: "reference/admin-api/nowhere", lang: "en", helpful: true })).status).toBe(404);
  });

  it("refuses a sentence too long without cutting it, an answer older than an hour, and anything not the docs' own pages'", async () => {
    const id = await feedback.recordDocsVote({ path: PAGE, lang: "en", helpful: true });
    ids.push(id);
    const long = await ask({ id, comment: "x".repeat(503) });
    expect(long.status).toBe(422);
    expect(await long.json()).toMatchObject({ over: 3 });
    expect(await feedback.addDocsComment(id, "   ")).toEqual({ ok: true });
    const [kept] = await db().execute<Row>(sql`select comment from commerce.docs_feedback where id = ${id}::uuid`);
    expect(kept.comment).toBeNull();

    const old = await feedback.recordDocsVote({ path: PAGE, lang: "en", helpful: true });
    ids.push(old);
    await db().execute(sql`update commerce.docs_feedback set created_at = now() - interval '61 minutes' where id = ${old}::uuid`);
    expect(await feedback.addDocsComment(old, `Late ${run}`)).toEqual({ ok: false, reason: "gone" });

    expect((await ask({ path: PAGE, lang: "en", helpful: true }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await ask("not json")).status).toBe(400);
    expect((await ask({ path: PAGE, lang: "en", helpful: true, email: "a@b.example" })).status).toBe(400);
    expect((await ask({ id: "not-an-id", comment: "x" })).status).toBe(400);
    // The database holds the same rules as the code.
    const refused = async (query: ReturnType<typeof sql>) => {
      try {
        await db().execute(query);
        return null;
      } catch (error) {
        return String((error as { cause?: { message?: string } }).cause?.message ?? error);
      }
    };
    expect(await refused(sql`insert into commerce.docs_feedback (path, lang, helpful) values ('../admin', 'en', true)`)).toMatch(/docs_feedback_path/);
    expect(await refused(sql`insert into commerce.docs_feedback (path, lang, helpful) values (${PAGE}, 'sv', true)`)).toMatch(/docs_feedback_lang/);
    expect(await refused(sql`insert into commerce.docs_feedback (path, lang, helpful, comment) values (${PAGE}, 'en', true, '')`)).toMatch(/docs_feedback_comment/);
  });

  it("lists answers newest first by page, yes or no and sentence, counts each page, and takes a sentence away keeping its vote", async () => {
    const path = `owners/test-${run}/page`;
    const make = async (helpful: boolean, comment: string | null) => {
      const id = await feedback.recordDocsVote({ path, lang: "en", helpful });
      ids.push(id);
      if (comment) await feedback.addDocsComment(id, comment);
      return id;
    };
    const first = await make(true, null);
    const second = await make(false, `Unclear ${run}`);
    const third = await make(false, null);
    expect((await feedback.listDocsFeedback({ path })).map((r) => r.id)).toEqual([third, second, first]);
    expect((await feedback.listDocsFeedback({ path, helpful: false })).map((r) => r.id)).toEqual([third, second]);
    expect((await feedback.listDocsFeedback({ path, withComment: true })).map((r) => r.id)).toEqual([second]);
    expect((await feedback.tallyDocsFeedback()).find((t) => t.path === path)).toMatchObject({ yes: 1, no: 2, comments: 1 });

    expect(await feedback.removeDocsComment(admin, second)).toBe(true);
    expect(await feedback.removeDocsComment(admin, second)).toBe(false);
    const [row] = await db().execute<Row>(sql`select helpful, comment from commerce.docs_feedback where id = ${second}::uuid`);
    expect(row).toEqual({ helpful: false, comment: null });
    const [audited] = await db().execute<Row>(sql`select details from commerce.audit_log where account_id = ${admin.id}::uuid and action = 'platform.docs_comment_removed'`);
    expect(audited.details).toEqual({ id: second });
  });
});

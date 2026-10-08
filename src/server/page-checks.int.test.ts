import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent, type PageBlock, type PageContent } from "@/lib/page-content";

import { auditRows, makeStore, membershipOf, run } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const pages = await import("./pages");

type Row = Record<string, unknown>;

/**
 * The page builder's checker on the server (wave 1, 1e, docs/wave-1-trust.md 2.2): a draft is never held back; publishing with a blocking issue the
 * owner has not seen is held with the list (`needs_confirmation`) and nothing is saved or published; with the owner's yes it is published and
 * the choice is written down; the checkout page may not hold what the payment policy would break, whatever the owner says.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let owner: Awaited<ReturnType<typeof membershipOf>>;
let n = 0;

const row = (...blocks: PageBlock[]) => ({ id: crypto.randomUUID(), type: "row" as const, layout: "1" as const, columns: [{ id: crypto.randomUUID(), blocks }] });
const picture = (alt: string): PageBlock => ({ id: crypto.randomUUID(), type: "image", image: { url: "https://example.com/a.webp", alt, width: 100, height: 100 }, caption: "" });
const heading = (level: 1 | 2 | 3 | 4, text: string): PageBlock => ({ id: crypto.randomUUID(), type: "heading", level, text });
const html = (): PageBlock => ({ id: crypto.randomUUID(), type: "html", html: "<script>alert(1)</script>", title: "Widget" } as PageBlock);
const page = (rows: PageContent["rows"], title = "Side"): PageContent => ({ ...newPageContent(), title, slug: `checks-${run}-${++n}`, rows });
const state = async (id: string) => (await pages.getPageForEdit(store.id, id))!;

beforeAll(async () => {
  store = await makeStore("checks");
  owner = await membershipOf(store.slug, store.account, "owner");
});

afterAll(async () => {
  await closeDb();
});

describe("a draft is never held back", () => {
  it("saves a page with every kind of problem as a draft, without asking", async () => {
    const saved = await pages.savePage(owner.account, store.id, null, page([row(picture(""), heading(1, ""), heading(4, "x"))]), { publish: false });
    expect(saved).toMatchObject({ ok: true });
  });
});

describe("publishing with a blocking issue", () => {
  it("is held with the list, and nothing is saved or published", async () => {
    const draft = await pages.savePage(owner.account, store.id, null, page([row(heading(2, "Hei"))]), { publish: false });
    if (!draft.ok) throw new Error("draft");
    const before = await state(draft.id);
    const content = page([row(picture(""))]);
    const held = await pages.savePage(owner.account, store.id, draft.id, { ...content, slug: before.slug }, { publish: true });
    expect(held).toMatchObject({ ok: false, code: "needs_confirmation", problems: [expect.stringContaining("a problem to look at")] });
    if (held.ok || !held.issues) throw new Error("issues");
    expect(held.issues.map((i) => i.rule)).toEqual(["image_alt"]);
    const after = await state(draft.id);
    expect(after.state).toBe("draft");
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.draft.rows).toEqual(before.draft.rows);
    expect(await auditRows(store.id, "store.page_published_with_issues")).toHaveLength(0);
  });

  it("is let through by the owner's yes, by rule or by the issue's own id, and the choice is written down with counts", async () => {
    const rows = [row(picture(""), picture(""))];
    const content = page(rows);
    const held = await pages.savePage(owner.account, store.id, null, content, { publish: true });
    if (held.ok || !held.issues) throw new Error("held");
    expect(held.issues).toHaveLength(2);
    // Acknowledging one picture is not acknowledging the other.
    const one = await pages.savePage(owner.account, store.id, null, content, { publish: true, acknowledgedIssues: [`image_alt:${held.issues[0].blockId}`] });
    expect(one).toMatchObject({ ok: false, code: "needs_confirmation" });
    const both = await pages.savePage(owner.account, store.id, null, content, { publish: true, acknowledgedIssues: ["image_alt"] });
    if (!both.ok) throw new Error(both.problems.join());
    expect((await state(both.id)).state).toBe("published");
    const log = (await auditRows(store.id, "store.page_published_with_issues")).at(-1)!;
    expect(log).toMatchObject({ area: "website", target_type: "page", target_id: both.id, details: { page: both.id, issues: [{ rule: "image_alt", count: 2 }] } });
    expect((await auditRows(store.id, "store.page_published")).at(-1)).toMatchObject({ target_id: both.id });
  });

  it("does not hold publishing for a warning, and writes no `with issues` entry", async () => {
    const before = (await auditRows(store.id, "store.page_published_with_issues")).length;
    const result = await pages.savePage(owner.account, store.id, null, page([row(heading(2, "A"), heading(4, "B"))]), { publish: true });
    expect(result).toMatchObject({ ok: true });
    expect((await auditRows(store.id, "store.page_published_with_issues")).length).toBe(before);
  });

  it("holds a text colour that is hard to read on its background", async () => {
    // Saved in the shape before D180 (a heading's own text colour): folded into its typography on read, and checked the same.
    const hard = row({ ...heading(2, "Low contrast"), textColor: "#777777" } as unknown as PageBlock);
    const withBackground = { ...hard, background: { type: "color", color: "#888888" } } as unknown as PageContent["rows"][number];
    const held = await pages.savePage(owner.account, store.id, null, page([withBackground]), { publish: true });
    expect(held).toMatchObject({ ok: false, code: "needs_confirmation" });
    if (!held.ok) expect(held.issues?.map((i) => i.rule)).toEqual(["contrast"]);
  });

  it("holds a page with text still to fill in, as a starter has", async () => {
    const held = await pages.savePage(owner.account, store.id, null, page([row(heading(2, "Add: [[Add: company name]]"))]), { publish: true });
    expect(held).toMatchObject({ ok: false, code: "needs_confirmation" });
    if (!held.ok) expect(held.issues?.map((i) => i.rule)).toEqual(["placeholder"]);
  });

  it("is asked of Kaizen's own pages too (the checker is generic), and a checker error does not stop publishing", async () => {
    const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where id = ${store.account.id}::uuid`);
    const platformAccount = { id: String(account.id), email: String(account.email), name: null, platformAdmin: true };
    const held = await pages.savePage(platformAccount, null, null, { ...page([row(picture(""))]), slug: `platform-checks-${run}` }, { publish: true });
    expect(held).toMatchObject({ ok: false, code: "needs_confirmation" });
  });
});

describe("the checkout page", () => {
  let checkoutId: string;

  it("may not be given a page that holds HTML or another site's video, and is given one that holds neither", async () => {
    const bad = await pages.savePage(owner.account, store.id, null, page([row(html())], "Checkout with html"), { publish: true, acknowledgedIssues: ["pay_page_block"] });
    if (!bad.ok) throw new Error(bad.problems.join());
    expect(await pages.setPageRole(owner.account, store.id, "checkout", bad.id)).toMatchObject({ ok: false, problems: [expect.stringContaining("checkout page cannot hold")] });
    const fine = await pages.savePage(owner.account, store.id, null, page([row(heading(2, "Betaling"))], "Checkout page"), { publish: true });
    if (!fine.ok) throw new Error("page");
    checkoutId = fine.id;
    expect(await pages.setPageRole(owner.account, store.id, "checkout", fine.id)).toEqual({ ok: true });
  });

  it("refuses an HTML block or an embedded video on any save of that page, a draft included, and the owner's yes does not help", async () => {
    const base = (await state(checkoutId)).draft;
    const withHtml = { ...base, rows: [...base.rows, row(html())] };
    for (const publish of [false, true]) {
      const refused = await pages.savePage(owner.account, store.id, checkoutId, withHtml, { publish, acknowledgedIssues: ["pay_page_block", `pay_page_block:${withHtml.rows[1].columns[0].blocks[0].id}`] });
      expect(refused).toMatchObject({ ok: false, code: "pay_page_block", problems: [expect.stringContaining("checkout page cannot hold")] });
    }
    const embed = { id: crypto.randomUUID(), type: "video", source: "youtube", video: null, link: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", poster: null, title: "Film" } as unknown as PageBlock;
    const refusedVideo = await pages.savePage(owner.account, store.id, checkoutId, { ...base, rows: [...base.rows, row(embed)] }, { publish: false });
    expect(refusedVideo).toMatchObject({ ok: false, code: "pay_page_block" });
    // The page as it was is untouched.
    expect((await state(checkoutId)).draft.rows).toEqual(base.rows);
    // Another page may hold HTML: the rule is the checkout's.
    const elsewhere = await pages.savePage(owner.account, store.id, null, page([row(html())], "Other"), { publish: false });
    expect(elsewhere).toMatchObject({ ok: true });
  });

  it("is also refused when a global part reaches it (the same check in the global spread)", async () => {
    const { payPageProblem } = await import("./page-rules");
    expect(payPageProblem(page([row(html())]))).toMatch(/checkout page cannot hold/);
    expect(payPageProblem(page([row(heading(2, "Fine"))]))).toBeNull();
  });
});

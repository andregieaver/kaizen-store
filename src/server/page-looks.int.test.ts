import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const looks = await import("./page-looks");
const { checkStep } = await import("./autopilot-checks");
const { savePage } = await import("./pages");
const { newStore } = await import("./inventory-test-support");
const { OwnerToolError } = await import("./owner-tool-error");
const { newPageContent } = await import("@/lib/page-content");
const { lookTokenValid } = await import("@/lib/page-look");
type ShotFacts = import("@/lib/page-look").ShotFacts;
type Finding = import("@/lib/page-look").Finding;
type LookDeps = import("./page-looks").LookDeps;

type Row = Record<string, unknown>;

/**
 * Looks at pages (D310, `docs/ai-autopilot.md` 9) with a stand-in browser and model: a look is asked for, run and read back; what code, the
 * accessibility checker, the claims filter and the model found are its findings; with no model it says so; a page is looked at three
 * times an hour at most; another store's page is never looked at; the autopilot's page check that looks fails on a blocking finding.
 */

let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;
let fixedPage = "";
let brokenPage = "";
let otherPage = "";

const PICTURE = Buffer.from("not really a picture");
const fine: ShotFacts = { sideways: false, brokenPictures: 0, words: 80, actionInFirstScreen: true };
const shotsAt: string[] = [];

/** A browser that photographs nothing: it says what code would have measured, sideways on a phone for the broken page. */
const photograph: LookDeps["photograph"] = async (url, width) => {
  shotsAt.push(`${width} ${url}`);
  const broken = url.includes(brokenPage);
  return { picture: PICTURE, facts: { ...fine, sideways: broken && width === "phone" } };
};
const modelSays = (findings: Finding[] | null | "no_model"): LookDeps["judge"] => async (_store, _account, pictures) => {
  expect(pictures.map((p) => p.width)).toEqual(expect.arrayContaining(["phone", "computer"]));
  return findings;
};
const overlap: Finding = { check: "overlap", where: "phone", place: "the top banner", severity: "blocking", says: "The heading lies over the picture.", by: "model" };

/** Runs the look the tool asked for, in place of the looks route. */
const runNow = (judge: LookDeps["judge"]): LookDeps => ({ trigger: async (id) => void (await looks.runLook(id, { photograph, judge, origin: "https://admin.example" })) });

const ctxOf = (s: typeof store) => ({ account: s.member.account, store: s.member.store });

async function makePage(s: typeof store, slug: string, rows: unknown[]): Promise<string> {
  const content = { ...newPageContent(), title: slug, slug, rows };
  const saved = await savePage(s.member.account, s.storeId, null, content, { publish: false, type: "page", fonts: async () => ({ ok: true }) });
  if (!saved.ok) throw new Error(saved.problems.join(" "));
  return saved.id;
}

beforeAll(async () => {
  store = await newStore("looks");
  other = await newStore("looks-other");
  fixedPage = await makePage(store, "looks-fine", [
    { id: "f-row", type: "row", layout: "1", columns: [{ id: "f-col", blocks: [{ id: "f-h", type: "heading", text: "Lunch for your team", level: 2 }] }] },
  ]);
  brokenPage = await makePage(store, "looks-broken", [
    {
      id: "b-row",
      type: "row",
      layout: "1",
      columns: [
        {
          id: "b-col",
          blocks: [
            { id: "b-h", type: "heading", text: "The best price in town", level: 2 },
            { id: "b-img", type: "image", image: { url: "https://media.example/kitchen.webp", width: 800, height: 600, alt: "" }, caption: "" },
          ],
        },
      ],
    },
  ]);
  otherPage = await makePage(other, "looks-theirs", []);
}, 120_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.page_looks where store_id in (${store.storeId}::uuid, ${other.storeId}::uuid)`);
  await closeDb();
});

describe("a look at a page's draft", () => {
  it("is taken at a phone's and a computer's width through the page's own signed address, and is fine when nothing blocks", async () => {
    shotsAt.length = 0;
    const answer = await looks.lookAtPageTool(ctxOf(store), { page: "looks-fine", type: "page" }, runNow(modelSays([])));
    expect(answer).toMatchObject({ what: '"looks-fine"', status: "fine: nothing that blocks", findings: [] });
    expect(shotsAt.map((s) => s.split(" ")[0])).toEqual(["phone", "computer"]);
    const url = new URL(shotsAt[0].split(" ")[1]);
    expect(url.origin + url.pathname).toBe(`https://admin.example/admin/account/look/${fixedPage}`);
    const key = Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY!, "base64");
    expect(lookTokenValid(key, fixedPage, url.searchParams.get("t") ?? undefined)).toBe(true);
    // The address opens that page's draft, and no other page's.
    expect(await looks.lookDraft(fixedPage, url.searchParams.get("t") ?? undefined)).toMatchObject({ storeSlug: store.member.store.slug, type: "page" });
    expect(await looks.lookDraft(brokenPage, url.searchParams.get("t") ?? undefined)).toBeNull();
  });

  it("finds what code measured, what the model saw, the checker's blocking issue and a claim, and is read back by its id", async () => {
    const answer = await looks.lookAtPageTool(ctxOf(store), { page: brokenPage, type: "page" }, runNow(modelSays([overlap])));
    expect(answer.status).toBe("needs changes");
    const says = (answer.findings ?? []).map((f) => f.says);
    expect(says).toEqual(
      expect.arrayContaining([
        "The heading lies over the picture.",
        "The page is wider than a phone's screen, so it scrolls sideways.",
        expect.stringContaining('"best price"'),
      ]),
    );
    expect(answer.findings?.some((f) => /alt|describe|description/i.test(f.says))).toBe(true);
    const again = await looks.getPageLookTool(ctxOf(store), { look: answer.look });
    expect(again).toEqual(answer);
    // Another store reads none of it.
    await expect(looks.getPageLookTool(ctxOf(other), { look: answer.look })).rejects.toBeInstanceOf(OwnerToolError);
  });

  it("says when only code looked, and when the look is still being taken", async () => {
    const coded = await looks.lookAtPageTool(ctxOf(store), { page: "looks-fine", type: "page" }, runNow(modelSays("no_model")));
    expect(coded).toMatchObject({ status: "fine: nothing that blocks", note: expect.stringContaining("no model that sees pictures") });
    const waiting = await looks.lookAtPageTool(ctxOf(store), { page: "looks-fine", type: "page" }, { trigger: async () => {} });
    expect(waiting).toMatchObject({ status: "being looked at", note: expect.stringContaining("get_page_look") });
  });

  it("is refused a fourth time in an hour, and never reaches another store's page", async () => {
    // The fine page was looked at three times above.
    await expect(looks.lookAtPageTool(ctxOf(store), { page: "looks-fine", type: "page" }, runNow(modelSays([])))).rejects.toThrow(/looked at 3 times in the last hour/);
    await expect(looks.lookAtPageTool(ctxOf(store), { page: otherPage, type: "page" }, runNow(modelSays([])))).rejects.toThrow(/No page/);
  });

  it("is tried again once when the browser fails, then fails with plain words", async () => {
    const id = await looks.requestLook(ctxOf(store), "store");
    const failing: LookDeps = { photograph: async () => Promise.reject(new Error("page.screenshot: Protocol error (Page.captureScreenshot)")), judge: modelSays([]) };
    await looks.runLook(id, failing);
    expect((await looks.readLook(store.member.store, id))?.status).toBe("queued");
    await looks.runLook(id, failing);
    const failed = await looks.readLook(store.member.store, id);
    expect(failed).toMatchObject({ status: "failed", problem: expect.stringContaining("The browser stopped") });
  });
});

describe("a look at the store", () => {
  it("photographs its home, a product page and the cart at their live addresses", async () => {
    shotsAt.length = 0;
    const answer = await looks.lookAtStoreTool(ctxOf(store), runNow(modelSays([])));
    expect(answer).toMatchObject({ status: "fine: nothing that blocks" });
    const urls = [...new Set(shotsAt.map((s) => s.split(" ")[1]))];
    expect(urls).toHaveLength(3);
    expect(urls[1]).toMatch(/\/p\/[^/]+$/);
    expect(urls[2]).toMatch(/\/cart$/);
  });
});

describe("the autopilot's page check that looks", () => {
  it("fails the try with the findings on a blocking one, and passes a fine look", async () => {
    const [{ slug }] = await db().execute<Row>(sql`select slug from commerce.pages where id = ${brokenPage}::uuid`);
    const failed = await checkStep(store.member.store, { kind: "page", slug: String(slug), published: false, looks: true }, { account: store.member.account, look: runNow(modelSays([overlap])) });
    expect(failed).toMatchObject({ ok: false, problem: expect.stringContaining("Looking at the page found: the top banner (phone): The heading lies over the picture.") });
    await db().execute(sql`delete from commerce.page_looks where page_id = ${fixedPage}::uuid`);
    expect(await checkStep(store.member.store, { kind: "page", slug: "looks-fine", published: false, looks: true }, { account: store.member.account, look: runNow(modelSays([])) })).toEqual({ ok: true });
    // Without `looks` nothing is photographed.
    shotsAt.length = 0;
    expect(await checkStep(store.member.store, { kind: "page", slug: "looks-fine", published: false, looks: false }, { account: store.member.account, look: runNow(modelSays([overlap])) })).toEqual({ ok: true });
    expect(shotsAt).toHaveLength(0);
  });
});

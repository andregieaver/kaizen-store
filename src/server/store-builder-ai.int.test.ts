import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
// Google Fonts is outside the database: the theme here is made from scratch, so only fonts would be fetched.
vi.mock("./fonts", async (original) => ({ ...(await original<typeof import("./fonts")>()), installFonts: async () => ({ ok: true }) }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

/**
 * A store drafted from a description, a drafted header or footer and Change with AI (D351), with the site's AI played by code as in
 * `site-tools.int.test.ts` (D308 A2): the plan and each section's words the way the page studio asks for them, and a picture made
 * without a picture model. Everything else (the studio's checks, the claims filter, the builder's rows, `savePage()`) runs for real.
 */
const fake = vi.hoisted(() => {
  const FACT = "We deliver in Oslo on weekdays";
  const link = (system: string) => /^- (\S+) \(/m.exec(system.slice(system.indexOf("link to") >= 0 ? system.indexOf("link to") : system.indexOf("addresses:")))?.[1] ?? "";
  const plan = (system: string) =>
    JSON.stringify({
      title: "Catering",
      slug: "catering",
      description: "Lunch for companies.",
      sections: [
        { pattern: "hero", variant: "split-right", name: "Opening", brief: "Welcome", links: [link(system)], picture: { prompt: "A long table set for lunch in a bright office", alt: "A lunch table" } },
        { pattern: "features", name: "What we offer", brief: "What is on the menu" },
        { pattern: "text", name: "Delivery", brief: "Where we deliver" },
        { pattern: "callToAction", name: "Ask us", brief: "Ask for a quote", links: [link(system)] },
      ],
    });
  const copy = (system: string, user: string) => {
    const name = /Write section \d+, "([^"]+)"/.exec(user)?.[1] ?? "";
    const href = link(system);
    if (name === "Opening") return { heading: "Lunch for your team", text: "Fresh lunch, made in the morning.", buttons: [{ label: "Ask us", href }] };
    if (name === "What we offer")
      return { heading: "What we offer", items: ["Salads", "Soups", "Bread"].map((title) => ({ title, text: `${title} every day.`, icon: "check" })) };
    // A claim the site cannot back, written every time it is asked: the sentence goes and the owner's fact stays.
    if (name === "Delivery") return { heading: "Delivery", text: `${user.includes(FACT) ? FACT : "We deliver"}. Only 2 left this week!` };
    if (name === "Our story") return { heading: "Our story", text: "We started cooking for offices in 1990." };
    return { heading: name, text: "Write to us for a quote.", buttons: href ? [{ label: "Write to us", href }] : [] };
  };
  return {
    FACT,
    calls: [] as string[],
    answer(messages: { role: string; content: string }[]) {
      const system = messages[0]?.content ?? "";
      const user = messages[messages.length - 1]?.content ?? "";
      if (system.includes("planning a new page")) {
        fake.calls.push("plan");
        return plan(system);
      }
      fake.calls.push("copy");
      return JSON.stringify(copy(system, user));
    },
  };
});

vi.mock("./ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("./ai")>();
  const connection = { textModel: "m", provider: "openai", source: "platform", apiUrl: "https://ai.example", apiKey: "k", space: null, image: { model: "p" } };
  return {
    ...real,
    aiFor: async () => connection,
    completeText: async (_connection: unknown, messages: { role: string; content: string }[]) => ({ text: fake.answer(messages), region: null }),
  };
});
vi.mock("./ai-pictures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ai-pictures")>()),
  makePicture: async () => ({ ok: true, picture: { url: `https://media.example/made-${Math.random().toString(36).slice(2)}.webp`, thumbnailUrl: null, width: 1600, height: 1000 } }),
}));

const ownerTools = await import("./owner-tools");
const siteTools = await import("./site-tools");
const drafts = await import("./store-drafts");
const { changePageWithAi } = await import("./page-change-ai");
const { getPageForEdit } = await import("./pages");
const { newStore } = await import("./inventory-test-support");
const { pageBlocks, pageInput } = await import("@/lib/page-content");
const designs = await import("./design-presets");
const { parseDesignDetails } = await import("@/lib/design-presets");
const { OWNER_TOOLS } = await import("@/lib/owner-tools");

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;

let store: Awaited<ReturnType<typeof newStore>>;
const tags: string[] = [];
const ctx = () => ({ account: store.member.account, store: store.member.store, invalidate: (tag: string) => void tags.push(tag) });
const who = () => ({ account: store.member.account, store: store.member.store });
const count = async (query: ReturnType<typeof sql>) => Number((await db().execute<Row>(query))[0].n);

async function drain() {
  for (let round = 0; round < 10; round++) {
    const waiting = await count(sql`select count(*)::int as n from commerce.page_ai_jobs where store_id = ${store.storeId}::uuid and status = 'waiting'`);
    if (waiting === 0) return;
    await siteTools.runPageJobs(Date.now() + 20_000);
    await db().execute(sql`update commerce.page_ai_jobs set claimed_until = null where store_id = ${store.storeId}::uuid and status = 'waiting'`);
  }
}

beforeAll(async () => {
  store = await newStore("storedraft");
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("a store drafted from one description", () => {
  const description = { description: "We cater lunches for offices in Oslo.", front: { purpose: "Welcome companies", key_points: ["Lunch for 10 to 200"] }, facts: [fake.FACT] };

  it("refuses a claim before anything is asked or made", async () => {
    const before = fake.calls.length;
    const result = await drafts.draftStore(who(), { ...description, front: { purpose: "The lowest prices in Norway" } }, { kick: () => {} });
    expect(result).toMatchObject({ ok: false, problem: expect.stringContaining("claims") });
    expect(fake.calls.length).toBe(before);
    expect(await count(sql`select count(*)::int as n from commerce.store_drafts where store_id = ${store.storeId}::uuid`)).toBe(0);
  });

  let draftId = "";

  it("builds the pages as drafts in the background, one draft at a time, nothing published", async () => {
    const started = await drafts.draftStore(who(), { ...description, pages: [{ title: "About us", purpose: "Who we are" }] }, { kick: () => {} });
    expect(started).toMatchObject({ ok: true, pages: 2, theme: null });
    draftId = started.ok ? started.id : "";
    expect(await drafts.draftStore(who(), description, { kick: () => {} })).toMatchObject({ ok: false, problem: expect.stringContaining("publish or discard") });
    expect((await drafts.openDraft(store.storeId))?.ready).toBe(false);

    await drain();
    const view = await drafts.openDraft(store.storeId);
    expect(view).toMatchObject({ id: draftId, ready: true });
    expect(view!.pages.map((page) => page.status)).toEqual(["built", "built"]);
    for (const page of view!.pages) {
      const held = await getPageForEdit(store.storeId, page.pageId!, "page");
      expect(held?.state).toBe("draft");
      expect(pageInput.safeParse(held!.draft).success).toBe(true);
    }
  }, 90_000);

  it("publishes them with one press: the first the front page, the rest in the header's menu", async () => {
    const view = (await drafts.openDraft(store.storeId))!;
    const result = await drafts.publishDraft(who(), draftId, (tag) => void tags.push(tag));
    expect(result).toMatchObject({ ok: true, published: 2, notes: [] });
    const [row] = await db().execute<Row>(sql`select front_page_id, header_menu_id from commerce.stores where id = ${store.storeId}::uuid`);
    expect(String(row.front_page_id)).toBe(view.pages[0].pageId);
    // Added after the header menu's own links, which stay.
    const before = store.member.store.menus.find((menu) => menu.id === store.member.store.headerMenuId)!;
    expect(String(row.header_menu_id)).toBe(before.id);
    const [menu] = await db().execute<Row>(sql`select items from commerce.menus where id = ${before.id}::uuid`);
    const links = (menu.items as Answer[]).map((item) => item.link);
    expect(links.slice(0, before.items.length)).toEqual(before.items.map((item) => item.link));
    expect(links.slice(before.items.length)).toEqual([{ kind: "page", slug: expect.any(String) }]);
    for (const page of view.pages) expect((await getPageForEdit(store.storeId, page.pageId!, "page"))?.state).not.toBe("draft");
    expect(await drafts.openDraft(store.storeId)).toBeNull();
    expect(await drafts.publishDraft(who(), draftId, () => {})).toMatchObject({ ok: false });
  });

  it("lets a draft go, its pages kept as drafts; a theme the model chose by id waits in the library, not live", async () => {
    const [admin] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`draft-admin-${store.slug}@example.com`}, 'Admin', true) returning id, email`);
    const adminAccount = { id: String(admin.id), email: String(admin.email), name: "Admin", platformAdmin: true };
    const details = parseDesignDetails({ title: `Calm ${store.slug}`, summary: "Quiet and light." });
    if (!details.ok) throw new Error(details.problems.join(" "));
    const deps = { copyFile: async (bucket: string, _from: string, to: string) => `https://x.supabase.co/storage/v1/object/public/${bucket}/${to}`, installFonts: async () => ({ ok: true as const }) };
    const made = await designs.createDesign(adminAccount, { origin: { kind: "scratch" }, details: details.details }, deps);
    if (!made.ok) throw new Error(made.problems.join(" "));
    expect(await designs.publishDesign(adminAccount, made.id)).toMatchObject({ ok: true });

    const look = async () => (await db().execute<Row>(sql`select theme, header_id from commerce.stores where id = ${store.storeId}::uuid`))[0];
    const before = await look();
    const asked: string[] = [];
    const complete = (async (_c: unknown, messages: { content: string }[]) => {
      asked.push(messages[0].content);
      return { text: JSON.stringify({ theme: made.id, preset: "none-such" }), region: null };
    }) as never;
    const started = await drafts.draftStore(who(), description, { kick: () => {}, complete });
    expect(started).toMatchObject({ ok: true, theme: `Calm ${store.slug}` });
    expect(asked[0]).toContain(made.id);
    const view = await drafts.openDraft(store.storeId);
    expect(view?.theme?.title).toBe(`Calm ${store.slug}`);
    const [install] = await db().execute<Row>(sql`select live from commerce.store_theme_installs where id = ${view!.theme!.install}::uuid`);
    expect(install.live).toBe(false);
    expect(await look()).toEqual(before);
    const id = started.ok ? started.id : "";
    expect(await drafts.discardDraft(who(), id)).toBe(true);
    expect(await drafts.discardDraft(who(), id)).toBe(false);
    expect(await drafts.openDraft(store.storeId)).toBeNull();
  });
});

describe("draft_header_footer and use_header_footer", () => {
  it("drafts a centred header the site does not show, then shows it only through the gated tool", async () => {
    expect(OWNER_TOOLS.find((t) => t.name === "use_header_footer")).toMatchObject({ gate: "public" });
    const drafted = (await ownerTools.runOwnerTool(ctx(), "draft_header_footer", { kind: "header", look: "centred", title: "Centred header" })) as Answer;
    expect(drafted.done).toContain("keeps its header");
    const held = await getPageForEdit(store.storeId, drafted.header, "header");
    expect(held?.state).toBe("draft");
    const [before] = await db().execute<Row>(sql`select header_id from commerce.stores where id = ${store.storeId}::uuid`);
    expect(before.header_id).toBeNull();
    await expect(ownerTools.runOwnerTool(ctx(), "draft_header_footer", { kind: "header", look: "sideways" })).rejects.toThrow("look");

    expect(await siteTools.chooseHeaderFooterApprovalWords(ctx(), { kind: "header", page: drafted.header })).toBe('Publish the header "Centred header" and show it on the whole site.');
    await ownerTools.runOwnerTool(ctx(), "use_header_footer", { kind: "header", page: drafted.header });
    const [after] = await db().execute<Row>(sql`select header_id from commerce.stores where id = ${store.storeId}::uuid`);
    expect(String(after.header_id)).toBe(drafted.header);
    await ownerTools.runOwnerTool(ctx(), "use_header_footer", { kind: "header", page: "standard" });
    const [back] = await db().execute<Row>(sql`select header_id from commerce.stores where id = ${store.storeId}::uuid`);
    expect(back.header_id).toBeNull();
  });
});

describe("Change with AI", () => {
  const owner = () => ({ storeId: store.storeId, storeSlug: store.slug, account: store.member.account });
  const connection = { textModel: "m", provider: "openai", source: "platform", apiUrl: "https://ai.example", apiKey: "k", space: null } as never;

  it("makes the described change on the page as the editor holds it, saving nothing, and refuses a plan it cannot make", async () => {
    const front = (await db().execute<Row>(sql`select front_page_id from commerce.stores where id = ${store.storeId}::uuid`))[0].front_page_id;
    const held = (await getPageForEdit(store.storeId, String(front), "page"))!;
    const heading = pageBlocks(held.draft).find((block) => block.type === "heading")!;
    const answer = (text: string) => async () => ({ text, region: null });

    const done = await changePageWithAi(owner(), JSON.stringify(held.draft), "Make the first heading friendlier", {
      connection,
      complete: answer(JSON.stringify({ changes: [{ do: "set_text", key: `block.${heading.id}.text`, text: "Hello, hungry team" }] })) as never,
    });
    expect(done).toMatchObject({ ok: true });
    const changed = JSON.parse(done.ok ? done.content : "{}");
    expect(pageBlocks(changed).find((block) => block.id === heading.id)).toMatchObject({ text: "Hello, hungry team" });
    expect(pageInput.safeParse(changed).success).toBe(true);
    // Nothing saved.
    expect(pageBlocks((await getPageForEdit(store.storeId, String(front), "page"))!.draft).find((block) => block.id === heading.id)).toMatchObject({ text: heading.type === "heading" ? heading.text : "" });

    const unknown = await changePageWithAi(owner(), JSON.stringify(held.draft), "Change the footer", {
      connection,
      complete: answer(JSON.stringify({ changes: [{ do: "set_text", key: "block.nope.text", text: "x" }] })) as never,
    });
    expect(unknown).toMatchObject({ ok: false, problem: expect.stringContaining("Nothing was changed") });
    const claim = await changePageWithAi(owner(), JSON.stringify(held.draft), "Say we are cheapest", {
      connection,
      complete: answer(JSON.stringify({ changes: [{ do: "set_text", key: `block.${heading.id}.text`, text: "The lowest prices in Norway" }] })) as never,
    });
    expect(claim).toMatchObject({ ok: false });
    expect(await changePageWithAi(owner(), JSON.stringify(held.draft), "x", { connection })).toMatchObject({ ok: false });
    expect(await changePageWithAi(owner(), JSON.stringify(held.draft), "Make it nicer", { connection, complete: answer("I cannot") as never })).toMatchObject({ ok: false, problem: expect.stringContaining("could not be read") });
  });
});

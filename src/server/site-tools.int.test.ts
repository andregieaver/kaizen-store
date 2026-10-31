import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

/**
 * The site's AI, played by code (D308 A2): the plan and each section's words the way the page studio asks for them, and a picture made
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
const managerTools = await import("./manager-tools");
const { getPageForEdit, savePage } = await import("./pages");
const pageAi = await import("./page-ai");
const { EMPTY_BRIEF } = await import("@/lib/page-ai");
const { newStore } = await import("./inventory-test-support");
const { findClaims } = await import("@/lib/claims");
const { pageInput, newPageContent, pageBlocks } = await import("@/lib/page-content");
const { pageTexts } = await import("@/lib/page-translation");

type Row = Record<string, unknown>;
// The answers are read as the model reads them: loose JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;

let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;
const tags: string[] = [];

const ctxOf = (s: typeof store) => ({ account: s.member.account, store: s.member.store, invalidate: (tag: string) => void tags.push(tag) });
const run = (name: string, input: unknown, s = store) => ownerTools.runOwnerTool(ctxOf(s), name, input) as Promise<Answer>;
const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof ownerTools.OwnerToolError ? error.message : `not a tool refusal: ${String(error)}`;
  }
};
const count = async (query: ReturnType<typeof sql>) => Number((await db().execute<Row>(query))[0].n);
/** Every text of a page, as one string, to look for words in. */
const wordsOf = (content: Parameters<typeof pageTexts>[0]) => JSON.stringify([...pageTexts(content).values()].map((t) => t.value));

/** Runs the job until it has nothing left this store's tests asked for. */
async function drain() {
  for (let round = 0; round < 10; round++) {
    const waiting = await count(sql`select count(*)::int as n from commerce.page_ai_jobs where store_id = ${store.storeId}::uuid and status = 'waiting'`);
    if (waiting === 0) return;
    await siteTools.runPageJobs(Date.now() + 20_000);
    await db().execute(sql`update commerce.page_ai_jobs set claimed_until = null where store_id = ${store.storeId}::uuid and status = 'waiting'`);
  }
}

let builtId = "";

beforeAll(async () => {
  store = await newStore("sitetools");
  other = await newStore("sitetools-other");
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("build_page", () => {
  it("builds a page from a brief after its answer: a valid draft with the brief's facts and no claims, its picture made after", async () => {
    const started = await run("build_page", {
      title: "Catering",
      purpose: "Tell companies we cater lunches",
      key_points: ["Lunch for 10 to 200 people"],
      facts: [fake.FACT],
      pictures: true,
    });
    expect(started.building).toEqual(expect.any(String));
    expect(started.done).toContain("being built as a draft");
    // Nothing is built in the call itself.
    expect(await count(sql`select count(*)::int as n from commerce.pages where store_id = ${store.storeId}::uuid and draft ->> 'title' = 'Catering'`)).toBe(0);

    await drain();
    const builds = await run("list_page_builds", {});
    const build = builds.builds.find((b: Answer) => b.build === started.building);
    expect(build).toMatchObject({ title: "Catering", state: "built as a draft", pictures: { made: 1, waiting: 0, not_made: 0 } });
    expect(build.editor).toBe(`/admin/${store.slug}/pages/${build.page}`);
    // The sentence with the claim was left out, and the studio says so.
    expect(build.notes.join(" ")).toContain("claims");
    builtId = build.page;

    const page = await getPageForEdit(store.storeId, builtId, "page");
    expect(page?.state).toBe("draft");
    expect(pageInput.safeParse(page!.draft).success).toBe(true);
    const words = wordsOf(page!.draft);
    expect(words).toContain(fake.FACT);
    expect(findClaims(words)).toEqual([]);
    const picture = pageBlocks(page!.draft).find((block) => block.type === "image");
    expect(picture?.type === "image" && picture.image?.url).toMatch(/^https:\/\/media\.example\/made-/);
    expect(picture?.type === "image" && picture.image?.alt).toBe("A lunch table");
  }, 60_000);

  it("refuses a brief with a claim before anything is asked", async () => {
    const before = fake.calls.length;
    const problem = await refusal(run("build_page", { title: "Sale", purpose: "The lowest prices in Norway", pictures: false }));
    expect(problem).toContain("claims");
    expect(fake.calls.length).toBe(before);
  });

  it("gives a job up, with why, when who asked may no longer change the store's website", async () => {
    const [job] = await db().execute<Row>(sql`
      insert into commerce.page_ai_jobs (store_id, kind, asked_by, input)
      values (${store.storeId}::uuid, 'build', ${other.accountId}::uuid, ${JSON.stringify({ title: "Not theirs", purpose: "x", pictures: false })}::jsonb)
      returning id
    `);
    await drain();
    const [row] = await db().execute<Row>(sql`select status, problem from commerce.page_ai_jobs where id = ${String(job.id)}::uuid`);
    expect(row).toMatchObject({ status: "failed", problem: "The person who asked may no longer change this store's website." });
  }, 60_000);
});

describe("cancel_page_build (PSI AGT-03)", () => {
  // The brief the fake studio knows (the first build's), so a run gets as far as building.
  const job = async (title: string) => {
    const brief = { title, purpose: "Tell companies we cater lunches", key_points: ["Lunch for 10 to 200 people"], facts: [fake.FACT], pictures: false };
    const [row] = await db().execute<Row>(sql`
      insert into commerce.page_ai_jobs (store_id, kind, asked_by, input)
      values (${store.storeId}::uuid, 'build', ${store.member.account.id}::uuid, ${JSON.stringify(brief)}::jsonb)
      returning id
    `);
    return String(row.id);
  };
  const state = async (id: string) => (await db().execute<Row>(sql`select status, problem from commerce.page_ai_jobs where id = ${id}::uuid`))[0];

  it("stops a build still waiting, so it is never built; says so for one already stopped, built, or not this site's", async () => {
    const id = await job("Stopped before");
    expect((await run("cancel_page_build", { build: id })).done).toBe(`"Stopped before" will not be built.`);
    expect(await state(id)).toMatchObject({ status: "failed", problem: "Stopped on request." });
    await drain();
    expect(await count(sql`select count(*)::int as n from commerce.pages where store_id = ${store.storeId}::uuid and draft ->> 'title' = 'Stopped before'`)).toBe(0);
    expect(await refusal(run("cancel_page_build", { build: id }))).toContain("already stopped");
    const [built] = await db().execute<Row>(sql`select id from commerce.page_ai_jobs where store_id = ${store.storeId}::uuid and kind = 'build' and status = 'done' and page_id is not null limit 1`);
    expect(await refusal(run("cancel_page_build", { build: String(built.id) }))).toContain("already built");
    expect(await refusal(run("cancel_page_build", { build: id }, other))).toContain("No page build of this site");
  });

  it("stops a build while it is being built, and deletes the draft that run made", async () => {
    const id = await job("Stopped during");
    let made = "";
    await siteTools.runPageJobs(Date.now() + 20_000, {
      // The page studio builds the draft, and the owner stops it before the run keeps it.
      build: async () => {
        const answer = await run("cancel_page_build", { build: id });
        expect(answer.done).toContain("was being built");
        const saved = await savePage(store.member.account, store.storeId, null, { ...newPageContent(), title: "Stopped during", slug: "stopped-during" }, { publish: false, type: "page", fonts: async () => ({ ok: true }) });
        if (!saved.ok) throw new Error(saved.problems.join(" "));
        made = saved.id;
        return { ok: true, pageId: saved.id, notes: [], pictures: [] };
      },
    });
    expect(made).not.toBe("");
    expect(await state(id)).toMatchObject({ status: "failed", problem: "Stopped on request." });
    expect(await count(sql`select count(*)::int as n from commerce.pages where id = ${made}::uuid`)).toBe(0);
  }, 60_000);
});

describe("get_page and edit_page", () => {
  it("reads the page by its address, with its texts by key and rows by id", async () => {
    const page = await run("get_page", { page: "catering" });
    expect(page.id).toBe(builtId);
    expect(page.state).toBe("a draft, not on the site");
    expect(page.rows.length).toBeGreaterThanOrEqual(4);
    expect(page.rows[0].texts.map((t: Answer) => t.text)).toContain("Lunch for your team");
  });

  it("changes one text and keeps the rest of the page, saved as a draft with a version", async () => {
    const before = (await getPageForEdit(store.storeId, builtId, "page"))!.draft;
    const versions = await count(sql`select count(*)::int as n from commerce.page_versions where page_id = ${builtId}::uuid`);
    const heading = pageBlocks(before).find((block) => block.type === "heading" && block.text === "Delivery")!;
    const done = await run("edit_page", { page: builtId, changes: [{ do: "set_text", key: `block.${heading.id}.text`, text: "Where we deliver" }] });
    expect(done.done).toContain("Saved as the draft.");
    const after = (await getPageForEdit(store.storeId, builtId, "page"))!.draft;
    const changed = pageBlocks(after).find((block) => block.id === heading.id);
    expect(changed?.type === "heading" && changed.text).toBe("Where we deliver");
    // Everything else is as it was.
    const strip = (content: typeof before) => JSON.stringify(content).replace(/"Where we deliver"|"Delivery"/g, "");
    expect(strip(after)).toBe(strip(before));
    expect(await count(sql`select count(*)::int as n from commerce.page_versions where page_id = ${builtId}::uuid`)).toBe(versions + 1);
  });

  it("adds a section written by the studio's writer between the rows asked, and refuses what cannot be made before writing anything", async () => {
    const page = await run("get_page", { page: builtId });
    const done = await run("edit_page", { page: builtId, changes: [{ do: "add_section", pattern: "text", name: "Our story", brief: "How we began", facts: ["Since 1990"], at: 2 }] });
    expect(done.done).toContain('Added "Our story" as row 2.');
    const after = await run("get_page", { page: builtId });
    expect(after.rows.length).toBe(page.rows.length + 1);
    expect(after.rows[1].texts.map((t: Answer) => t.text)).toContain("Our story");
    expect(after.rows[2].row).toBe(page.rows[1].row);

    const calls = fake.calls.length;
    const problem = await refusal(
      run("edit_page", {
        page: builtId,
        changes: [
          { do: "add_section", pattern: "text", name: "More", brief: "More" },
          { do: "set_text", key: "block.nowhere.text", text: "x" },
        ],
      }),
    );
    expect(problem).toContain("Change 2");
    expect(fake.calls.length).toBe(calls);
  }, 60_000);

  it("never finds another store's page", async () => {
    expect(await refusal(run("get_page", { page: builtId }, other))).toContain("No page");
    expect(await refusal(run("edit_page", { page: "catering", changes: [{ do: "remove_row", row: "x" }] }, other))).toContain("No page");
  });
});

describe("publish_page", () => {
  let pageId = "";

  beforeAll(async () => {
    const content = {
      ...newPageContent(),
      title: "Our kitchen",
      slug: "our-kitchen",
      rows: [
        {
          id: "k-row",
          type: "row" as const,
          layout: "1" as const,
          columns: [{ id: "k-col", blocks: [{ id: "k-img", type: "image" as const, image: { url: "https://media.example/kitchen.webp", width: 800, height: 600, alt: "" }, caption: "" }] }],
        },
      ],
    };
    const saved = await savePage(store.member.account, store.storeId, null, content, { publish: false, type: "page", fonts: async () => ({ ok: true }) });
    if (!saved.ok) throw new Error(saved.problems.join(" "));
    pageId = saved.id;
  });

  it("waits for the owner's yes, with the page's own title", async () => {
    expect(await ownerTools.gateNeeded(store.member.store, "publish_page", { page: pageId })).toBe(true);
    expect(await siteTools.publishApprovalWords(ctxOf(store), { page: pageId })).toBe('Publish the page "Our kitchen", so visitors see its draft as it is now.');
  });

  it("is refused while the page has a blocking problem, before it is kept for a yes, and publishes once it is fixed", async () => {
    const problem = await refusal(ownerTools.preflightOwnerTool(ctxOf(store), "publish_page", { page: pageId }));
    expect(problem).toContain("to fix before it is published");
    expect(await refusal(run("publish_page", { page: pageId }))).toContain("to fix before it is published");
    expect((await getPageForEdit(store.storeId, pageId, "page"))?.state).toBe("draft");

    await run("edit_page", { page: pageId, changes: [{ do: "set_text", key: "block.k-img.alt", text: "Two cooks at a steel counter" }] });
    await ownerTools.preflightOwnerTool(ctxOf(store), "publish_page", { page: pageId });
    const done = await run("publish_page", { page: "our-kitchen" });
    expect(done.done).toBe('"Our kitchen" is published.');
    expect((await getPageForEdit(store.storeId, pageId, "page"))?.state).toBe("published");
    expect(tags).toContain(`pages:${store.storeId}`);
    const [entry] = await db().execute<Row>(sql`
      select area from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'store.assistant.publish_page' order by created_at desc limit 1
    `);
    expect(entry?.area).toBe("website");
  });
});

describe("set_page_place, save_menu and set_header_footer", () => {
  let menuId = "";

  it("makes a new menu at once, refusing a link into another store first", async () => {
    const items = [
      { text: "Shop", link: { kind: "products" } },
      { text: "Our kitchen", link: { kind: "page", slug: "our-kitchen" } },
    ];
    expect(await ownerTools.gateNeeded(store.member.store, "save_menu", { name: "Main", items })).toBe(false);
    const foreign = await refusal(run("save_menu", { name: "Main", items: [...items, { text: "Friends", link: { kind: "url", url: `/s/${other.slug}/no` } }] }));
    expect(foreign).toContain("goes to another store");
    expect(await count(sql`select count(*)::int as n from commerce.menus where store_id = ${store.storeId}::uuid and name = 'Main'`)).toBe(0);

    const done = await run("save_menu", { name: "Main", items: [...items, { text: "Instagram", link: { kind: "url", url: "https://www.instagram.com/example" }, new_tab: true }] });
    expect(done.done).toContain('Made the menu "Main" with 3 links.');
    expect(done.done).toContain("not shown anywhere yet");
    menuId = done.menu;
    const menus = await run("get_menus", {});
    const main = menus.menus.find((m: Answer) => m.id === menuId);
    expect(main.items.map((i: Answer) => i.text)).toEqual(["Shop", "Our kitchen", "Instagram"]);
    expect(main.shown_in).toEqual([]);
  });

  it("puts the menu and a logo from the library in the standard header, waiting for a yes, and then a change to the menu waits too", async () => {
    const logo = `https://media.example/${store.storeId}/logo.webp`;
    await db().execute(sql`
      insert into commerce.media (store_id, kind, url, thumbnail_url, bucket, path, thumbnail_path, file_name, content_type, size_bytes, width, height)
      values (${store.storeId}::uuid, 'image', ${logo}, null, 'product-media', ${`${store.storeId}/logo.webp`}, null, 'logo.webp', 'image/webp', 1000, 400, 120)
    `);
    expect(await ownerTools.gateNeeded(store.member.store, "set_header_footer", { header_menu: "Main", logo })).toBe(true);
    expect(await siteTools.headerFooterApprovalWords(ctxOf(store), { header_menu: "Main", logo })).toBe('Change the standard header and footer: the header shows the menu "Main"; a new logo.');
    expect(await refusal(ownerTools.preflightOwnerTool(ctxOf(store), "set_header_footer", { logo: "https://elsewhere.example/logo.png" }))).toContain("not a picture in the site's media library");

    await run("set_header_footer", { header_menu: "Main", logo });
    const [row] = await db().execute<Row>(sql`select header_menu_id, navigation from commerce.stores where id = ${store.storeId}::uuid`);
    expect(String(row.header_menu_id)).toBe(menuId);
    expect((row.navigation as Answer).logo).toEqual({ url: logo, width: 400, height: 120 });
    expect(tags).toContain(`store:${store.slug}`);

    expect(await ownerTools.gateNeeded(store.member.store, "save_menu", { menu: "Main", items: [] })).toBe(true);
    expect(await siteTools.menuApprovalWords(ctxOf(store), { menu: "Main", items: [{ text: "Shop", link: { kind: "products" } }] })).toBe('Change the menu "Main" to 1 link: Shop.');
  });

  it("shows a published page in a place, refusing a draft before it is kept for a yes", async () => {
    expect(await ownerTools.gateNeeded(store.member.store, "set_page_place", { place: "front", page: "our-kitchen" })).toBe(true);
    expect(await refusal(ownerTools.preflightOwnerTool(ctxOf(store), "set_page_place", { place: "front", page: "catering" }))).toContain("Publish the page");
    expect(await siteTools.placeApprovalWords(ctxOf(store), { place: "front", page: "our-kitchen" })).toBe('Show the page "Our kitchen" as the front page.');

    const done = await run("set_page_place", { place: "front", page: "our-kitchen" });
    expect(done.done).toBe('"Our kitchen" is the front page now.');
    const [row] = await db().execute<Row>(sql`select front_page_id from commerce.stores where id = ${store.storeId}::uuid`);
    const [kitchen] = await db().execute<Row>(sql`select id from commerce.pages where store_id = ${store.storeId}::uuid and slug = 'our-kitchen'`);
    expect(String(row.front_page_id)).toBe(String(kitchen.id));
    // A page is in one place at a time.
    expect(await refusal(ownerTools.preflightOwnerTool(ctxOf(store), "set_page_place", { place: "blog", page: "our-kitchen" }))).toContain("front page already");

    await run("set_page_place", { place: "front", page: null });
    const [after] = await db().execute<Row>(sql`select front_page_id from commerce.stores where id = ${store.storeId}::uuid`);
    expect(after.front_page_id).toBeNull();
  });

  it("leaves a legal page to the owner", async () => {
    const staff = { ...ctxOf(store), holder: { role: "admin" as const, permissions: ["website:read", "website:write"] } };
    expect(await refusal(ownerTools.preflightOwnerTool(staff, "set_page_place", { place: "terms", page: "our-kitchen" }))).toContain("Only the store's owner");
  });
});

describe("the page studio's pictures in the background (PSI PERF-07)", () => {
  const ownerOf = (s: typeof store) => ({ storeId: s.storeId, storeSlug: s.slug, account: s.member.account });
  const history = [{ role: "user" as const, content: `A page about our catering. ${fake.FACT}.` }];
  const brief = { ...EMPTY_BRIEF, title: "Catering", purpose: "Tell companies we cater lunches" };

  async function studioBuild(s: typeof store) {
    const planned = await pageAi.planPage(ownerOf(s), history, brief);
    if (!planned.ok) throw new Error(planned.problem);
    const built = await pageAi.buildDraft(ownerOf(s), history, brief, planned.plan);
    if (!built.ok) throw new Error(built.problem);
    return built;
  }

  it("queues a built page's pictures for the background, says how they come along, and they go into its draft", async () => {
    const built = await studioBuild(store);
    expect(built.pictures.length).toBe(1);
    const scheduled: (() => Promise<unknown>)[] = [];
    expect(await siteTools.queueStudioPictures(ownerOf(store), built.pageId, built.pictures, { schedule: (work) => void scheduled.push(work) })).toBe(true);
    // Started after the answer, never in the request itself.
    expect(scheduled.length).toBe(1);
    expect(await siteTools.studioPictureStates(ownerOf(store), built.pageId)).toEqual([{ key: built.pictures[0].key, status: "waiting" }]);
    // Another store reads none of them.
    expect(await siteTools.studioPictureStates(ownerOf(other), built.pageId)).toEqual([]);

    await drain();
    const [state] = await siteTools.studioPictureStates(ownerOf(store), built.pageId);
    expect(state).toMatchObject({ key: built.pictures[0].key, status: "done", url: expect.stringMatching(/^https:\/\/media\.example\/made-/) });
    const page = await getPageForEdit(store.storeId, built.pageId, "page");
    expect(JSON.stringify(page!.draft)).toContain(state.url);
    const [job] = await db().execute<Row>(sql`select asked_by from commerce.page_ai_jobs where page_id = ${built.pageId}::uuid and kind = 'picture'`);
    expect(String(job.asked_by)).toBe(store.member.account.id);
  }, 60_000);

  it("leaves a demo store's pictures to the studio itself, which the background job never takes up", async () => {
    const demo = await newStore("sitetools-demo");
    await db().execute(sql`update commerce.stores set starter = true where id = ${demo.storeId}::uuid`);
    const built = await studioBuild(demo);
    expect(await siteTools.queueStudioPictures(ownerOf(demo), built.pageId, built.pictures, { schedule: () => undefined })).toBe(false);
    expect(await count(sql`select count(*)::int as n from commerce.page_ai_jobs where page_id = ${built.pageId}::uuid`)).toBe(0);
  }, 60_000);
});

describe("Kaizena Flow's own site", () => {
  let admin: { id: string; email: string; name: string | null; platformAdmin: boolean };
  let before: Row;
  const platform = (account = admin) => ({ account, store: null, flags: {}, connection: null, navigate: () => {}, invalidate: (tag: string) => void tags.push(tag) }) as never;
  const runPlatform = (name: string, input: unknown, account = admin) => managerTools.runPlatformTool(platform(account), name, input) as Promise<Answer>;

  beforeAll(async () => {
    const email = `site-admin-${Date.now().toString(36)}@example.com`;
    const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${email}, 'Admin', true) returning id`);
    admin = { id: String(row.id), email, name: "Admin", platformAdmin: true };
    [before] = await db().execute<Row>(sql`select navigation, business, header_menu_id, footer_menu_id from commerce.platform_settings`);
  });

  afterAll(async () => {
    // Kaizena Flow's header and footer are the whole test database's: they are put back as they were.
    await db().execute(sql`
      update commerce.platform_settings set navigation = ${JSON.stringify(before.navigation ?? null)}::jsonb,
        business = ${JSON.stringify(before.business ?? {})}::jsonb,
        header_menu_id = ${before.header_menu_id ? String(before.header_menu_id) : null}::uuid, footer_menu_id = ${before.footer_menu_id ? String(before.footer_menu_id) : null}::uuid
    `);
  });

  it("builds, changes and publishes one of Kaizena Flow's own pages, in the admin's name and only for an admin", async () => {
    expect(await refusal(runPlatform("build_page", { title: "x", purpose: "x" }, { ...admin, platformAdmin: false }))).toBe("Only platform admins can do this.");
    const started = await runPlatform("build_page", { title: "Catering", purpose: "Tell stores we cater their launch", facts: [fake.FACT], pictures: false });
    for (let round = 0; round < 5; round++) {
      const [left] = await db().execute<Row>(sql`select count(*)::int as n from commerce.page_ai_jobs where store_id is null and status = 'waiting'`);
      if (Number(left.n) === 0) break;
      await siteTools.runPageJobs(Date.now() + 20_000);
      await db().execute(sql`update commerce.page_ai_jobs set claimed_until = null where store_id is null and status = 'waiting'`);
    }
    const builds = await runPlatform("list_page_builds", {});
    const build = builds.builds.find((b: Answer) => b.build === started.building);
    expect(build).toMatchObject({ state: "built as a draft" });
    expect(build.editor).toBe(`/admin/platform/pages/${build.page}`);
    const [page] = await db().execute<Row>(sql`select store_id, published_at from commerce.pages where id = ${build.page}::uuid`);
    expect(page).toMatchObject({ store_id: null, published_at: null });

    const read = await runPlatform("get_page", { page: build.page });
    const opening = read.rows[0].texts.find((t: Answer) => t.text === "Lunch for your team");
    await runPlatform("edit_page", { page: build.page, changes: [{ do: "set_text", key: opening.key, text: "Lunch for your launch" }] });
    expect(await managerTools.platformGateNeeded("publish_page", { page: build.page })).toBe(true);
    await managerTools.preflightPlatformTool(platform(), "publish_page", { page: build.page });
    expect((await runPlatform("publish_page", { page: build.page })).done).toBe('"Catering" is published.');
    expect(tags).toContain("platform-pages");
    const [entry] = await db().execute<Row>(sql`
      select area from commerce.audit_log where store_id is null and action = 'platform.assistant.publish_page' and account_id = ${admin.id}::uuid
    `);
    expect(entry?.area).toBe("website");
  }, 60_000);

  it("makes one of its menus at once, puts it in the standard header on a yes, and then a change waits", async () => {
    const pages = await runPlatform("list_pages", {});
    const catering = pages.pages.find((p: Answer) => p.title === "Catering" && p.state === "published");
    const name = `AI menu ${Date.now().toString(36)}`;
    expect(await managerTools.platformGateNeeded("save_menu", { name, items: [] })).toBe(false);
    const made = await runPlatform("save_menu", { name, items: [{ text: "Start", link: { kind: "signUp" } }, { text: "Catering", link: { kind: "page", pageId: catering.id } }] });
    expect(made.done).toContain(`Made the menu "${name}" with 2 links.`);
    // A link into a store is a store's own business: Kaizena Flow's menus may show stores.
    await runPlatform("save_menu", { menu: name, items: [{ text: "A store", link: { kind: "url", url: `/s/${store.slug}` } }] });

    expect(await managerTools.platformGateNeeded("set_header_footer", { header_menu: name })).toBe(true);
    await runPlatform("set_header_footer", { header_menu: name });
    const [row] = await db().execute<Row>(sql`select header_menu_id from commerce.platform_settings`);
    expect(String(row.header_menu_id)).toBe(made.menu);
    expect(await managerTools.platformGateNeeded("save_menu", { menu: name, items: [] })).toBe(true);
  });

  it("chooses its front page, blog or 404 page only, from published pages", async () => {
    expect(await refusal(managerTools.preflightPlatformTool(platform(), "set_page_place", { place: "front", page: "nowhere" }))).toContain("No page");
    expect(await refusal(runPlatform("set_page_place", { place: "themes", page: null }))).toContain("could not be read");
  });
});

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { aiFormValues } from "@/lib/ai-provider";
import { EMPTY_BRIEF, type PagePlan, type PictureJob } from "@/lib/page-ai";
import { pageBlocks, pageInput, type PageContent } from "@/lib/page-content";
import { marketPath } from "@/lib/paths";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

// Storage is not reached in tests: a made picture is a known address.
const made = vi.fn(async () => ({
  ok: true as const,
  picture: { url: "https://cdn.example/ai-coffee.webp", thumbnailUrl: "https://cdn.example/ai-coffee-480.webp", width: 1600, height: 1067 },
}));
vi.mock("./ai-pictures", () => ({ makePicture: made }));

const ai = await import("./ai");
const studio = await import("./page-ai");
const stores = await import("./stores");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let storeId: string;
let storeSlug: string;
let account: Account;
let products: string;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`pageai-${run}@example.com`}, 'Kari', 'Kaffe') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`pageai-${run}`}, 'Kaffe', null) as id
  `);
  storeId = String(store.id);
  storeSlug = `pageai-${run}`;
  const [row] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`pageai-${run}@example.com`}`);
  account = { id: String(row.id), email: String(row.email), name: "Kari", platformAdmin: false };
  const form = new FormData();
  for (const [name, value] of Object.entries({ provider: "openai", apiKey: "sk-test-1234", textModel: "text-model", imageModel: "picture-model", minSimilarity: "0.5", enabled: "on" })) {
    form.set(name, value);
  }
  expect(await ai.saveAiSettings(account.id, storeId, aiFormValues(form))).toEqual({ ok: true });
  // Pages are written in the store's main language, and link within its market.
  const facts = (await studio.siteFacts({ storeId, storeSlug, account }, null))!;
  products = facts.links.find((link) => link.label === "All products")!.href;
  expect(products).toBe(marketPath(storeSlug, (await stores.getStore(storeSlug))!.markets[0].slug, "/products"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.ai_providers where store_id = ${storeId}::uuid`);
  await closeDb();
});

const owner = () => ({ storeId, storeSlug, account });

/** The provider's answers: by what the request's instructions say it is. */
function fakeModel(answer: (system: string, user: string, calls: number) => unknown) {
  const calls: { system: string; user: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: { role: string; content: string }[] };
      const system = body.messages[0].content;
      const user = body.messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
      calls.push({ system, user });
      const reply = answer(system, user, calls.length);
      return Response.json({ choices: [{ message: { content: typeof reply === "string" ? reply : JSON.stringify(reply) } }] });
    }),
  );
  return calls;
}

describe("the AI page studio (D92)", () => {
  it("interviews the owner with the site's facts, keeping the brief", async () => {
    const calls = fakeModel(() => ({ message: "Hvem er siden for?", ready: false, brief: { title: "Kaffen vår", purpose: "Vise frem kaffen" } }));
    const result = await studio.interviewTurn(owner(), [{ role: "user", content: "Jeg vil ha en side om kaffen vår" }], EMPTY_BRIEF);
    expect(result).toMatchObject({ ok: true, reply: { message: "Hvem er siden for?", ready: false, brief: { title: "Kaffen vår", purpose: "Vise frem kaffen" } } });
    expect(calls[0].system).toContain("Kaffe");
    expect(calls[0].system).toContain("Never invent facts");
    expect(calls.at(-1)!.user).toBe("Jeg vil ha en side om kaffen vår");
  });

  let plan: PagePlan;

  it("plans the page, asking again once when the answer cannot be read, and checks it", async () => {
    const calls = fakeModel((_system, _user, n) =>
      n === 1
        ? "Here is my plan: sections are hero and text."
        : {
            title: "Kaffen vår",
            slug: "kaffen-var",
            description: "Om kaffen vi brenner.",
            sections: [
              { pattern: "hero", variant: "split-right", name: "Åpning", brief: "Kaffe fra Bergen", links: [products], picture: { prompt: "A coffee roaster in a small roastery, morning light.", alt: "Kaffebrenner i et lite brenneri" } },
              { pattern: "features", name: "Hvorfor oss", brief: "Fersk, lokal, enkel" },
              { pattern: "reviews", name: "Anmeldelser" },
              { pattern: "callToAction", name: "Se kaffen", links: [products, "https://elsewhere.example"] },
            ],
          },
    );
    const result = await studio.planPage(owner(), [{ role: "user", content: "Om kaffen vår" }], { ...EMPTY_BRIEF, title: "Kaffen vår" });
    if (!result.ok) throw new Error(result.problem);
    expect(calls).toHaveLength(2);
    expect(calls[1].user).toContain("could not be read");
    expect(result.plan.sections.map((s) => s.pattern)).toEqual(["hero", "features", "callToAction"]);
    expect(result.plan.sections[2].links).toEqual([products]);
    expect(result.notes).toEqual(
      expect.arrayContaining([expect.stringContaining('"Anmeldelser"'), expect.stringContaining("https://elsewhere.example")]),
    );
    plan = result.plan;
  });

  let pageId: string;
  let jobs: PictureJob[];

  it("builds the draft: words for each section, claims taken out, saved and never published", async () => {
    fakeModel((_system, user) => {
      if (user.includes('"Åpning"')) return { heading: "Kaffe fra Bergen", text: "Brent hver uke.", buttons: [{ label: "Se kaffen", href: products }] };
      if (user.includes('"Hvorfor oss"')) {
        // A claim the first time; written again without it.
        return user.includes("phrases the site may not use")
          ? { heading: "Hvorfor oss", items: [{ title: "Fersk", text: "Brent hver uke." }, { title: "Lokal", text: "Fra Bergen." }] }
          : { heading: "Bærekraftig kaffe", items: [{ title: "Fersk", text: "Brent hver uke." }, { title: "Lokal", text: "Fra Bergen." }] };
      }
      // A claim both times: its sentence goes.
      return { heading: "Smak selv", text: "Bestill i dag. Kun i dag: fri frakt!", buttons: [{ label: "Til butikken", href: products }] };
    });
    const result = await studio.buildDraft(owner(), [{ role: "user", content: "Om kaffen vår" }], EMPTY_BRIEF, plan);
    if (!result.ok) throw new Error(result.problem);
    pageId = result.pageId;
    jobs = result.pictures;
    expect(result.notes).toEqual([expect.stringContaining('"Se kaffen": sentences with claims')]);
    const [row] = await db().execute<Row>(sql`select draft, published, published_at, type from commerce.pages where id = ${pageId}::uuid`);
    expect(row).toMatchObject({ published: null, published_at: null, type: "page" });
    const draft = pageInput.parse(row.draft) as PageContent;
    expect(draft).toMatchObject({ title: "Kaffen vår", slug: "kaffen-var" });
    const words = JSON.stringify(pageBlocks(draft));
    expect(words).toContain("Kaffe fra Bergen");
    expect(words).toContain("Hvorfor oss");
    expect(words).not.toMatch(/Bærekraftig|Kun i dag/);
    expect(words).toContain("Bestill i dag.");
    // One picture, the opening's, which is also the page's own; its prompt keeps words out of it.
    expect(jobs).toEqual([expect.objectContaining({ thumbnail: true, alt: "Kaffebrenner i et lite brenneri" })]);
    expect(jobs[0].prompt).toContain("No text, letters");
    const [logged] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action = 'store.page_ai_built'`);
    expect(logged.n).toBe(1);
  });

  it("fills a picture into its place and makes it the page's own, once", async () => {
    expect(await studio.fillPicture(owner(), pageId, jobs[0])).toEqual({ ok: true, url: "https://cdn.example/ai-coffee.webp" });
    expect(made).toHaveBeenCalledWith(expect.anything(), { storeId, accountId: account.id }, { prompt: jobs[0].prompt, alt: jobs[0].alt, shape: "landscape" });
    const [row] = await db().execute<Row>(sql`select draft from commerce.pages where id = ${pageId}::uuid`);
    const draft = row.draft as PageContent;
    expect(pageBlocks(draft).find((b) => b.type === "image")).toMatchObject({ image: { url: "https://cdn.example/ai-coffee.webp", width: 1600, alt: "Kaffebrenner i et lite brenneri" } });
    expect(draft.thumbnail).toMatchObject({ url: "https://cdn.example/ai-coffee.webp" });
    // A place already filled is left alone.
    expect(await studio.fillPicture(owner(), pageId, jobs[0])).toMatchObject({ ok: false, problem: expect.stringContaining("its place on the page has changed") });
  });

  it("works only on the owner's own pages, and without a picture model makes none", async () => {
    expect(await studio.fillPicture({ ...owner(), storeId: "00000000-0000-4000-8000-000000000000" }, pageId, jobs[0])).toMatchObject({ ok: false });
    expect(await studio.fillPicture(owner(), pageId, { ...jobs[0], prompt: "" })).toEqual({ ok: false, problem: "The picture could not be read." });
    const abilities = await studio.studioAbilities(storeId);
    expect(abilities).toEqual({ text: true, sees: true, pictures: true, hear: false, speak: false });
    expect(await studio.hearOwner(storeId, new Blob(["x"]))).toMatchObject({ ok: false, problem: expect.stringContaining("speech-to-text") });
  });
});

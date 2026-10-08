import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { aiFormValues } from "@/lib/ai-provider";
import { toMarket } from "@/lib/markets";
import { localizePage } from "@/lib/page-translation";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const ai = await import("./ai");
const altTexts = await import("./alt-texts");
const catalog = await import("./catalog");
const pages = await import("./pages");
const stores = await import("./stores");

const run = Date.now().toString(36);
const base = `https://files.example.com/storage/v1/object/public/product-media/${run}`;
let storeId: string;
let storeSlug: string;
let accountId: string;
const owner = () => ({ storeId, storeSlug });
/** A 1×1 PNG. */
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64"));

/**
 * A stand-in for the site's AI: pictures are served from the files'
 * addresses (one is missing), and the text model answers for each
 * language asked for, what the file's name says; it cannot see pictures
 * while `blind` is set.
 */
type Ask = { messages: { role: string; content: unknown }[] };
const asked: Ask[] = [];
let blind = false;
const WORDS: Record<string, Record<string, string>> = {
  kopp: {
    "nb-NO": "En hvit kopp på et trebord",
    "sv-SE": "En vit kopp på ett träbord",
    "da-DK": "En hvid kop på et træbord",
    en: "A white mug on a wooden table",
  },
  lampe: { "nb-NO": "En grønn bordlampe", "sv-SE": "En grön bordslampa", "da-DK": "En grøn bordlampe – kun i dag", en: "A green desk lamp" },
};
function fakeAi() {
  asked.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(base)) {
        if (url.includes("borte")) return new Response("Not found", { status: 404 });
        return new Response(PNG, { headers: { "Content-Type": "image/png" } });
      }
      const body = JSON.parse(String(init?.body)) as Ask;
      asked.push(body);
      if (blind) return Response.json({ error: { message: "Image input is not supported by this model" } }, { status: 400 });
      const text = (body.messages[1].content as { type: string; text?: string }[]).find((part) => part.type === "text")?.text ?? "";
      const words = Object.entries(WORDS).find(([name]) => text.includes(`File name: ${name}`))?.[1] ?? {};
      return Response.json({ choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(words)}\n\`\`\`` } }] });
    }),
  );
}

async function addPicture(name: string, values: { alt?: string; kind?: string; type?: string } = {}) {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.media (store_id, kind, url, thumbnail_url, bucket, path, file_name, content_type, alt, alt_source)
    values (${storeId}::uuid, ${values.kind ?? "image"}, ${`${base}/${name}.webp`}, ${`${base}/${name}-480.webp`},
      'product-media', ${`${run}/${name}.webp`}, ${`${name}.webp`}, ${values.type ?? "image/webp"}, ${values.alt ?? ""},
      ${values.alt ? "staff" : null})
    returning id, url
  `);
  return { id: String(row.id), url: String(row.url) };
}

const altOf = async (id: string) => {
  const [row] = await db().execute<Row>(sql`select alt, alt_translations, alt_source from commerce.media where id = ${id}::uuid`);
  return { alt: row.alt, translations: row.alt_translations, source: row.alt_source };
};

let kopp: { id: string; url: string };
let lampe: { id: string; url: string };
let beskrevet: { id: string; url: string };
let borte: { id: string; url: string };
let tegning: { id: string; url: string };
let film: { id: string; url: string };

beforeAll(async () => {
  storeSlug = `alt-${run}`;
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${storeSlug}@example.com`}, 'Test', 'Olas Butikk') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${storeSlug}, 'Olas Butikk', null) as id`);
  storeId = String(store.id);
  // Norway first, as a store in Norway has it.
  await db().execute(sql`update commerce.stores set country = 'NO', features = features || array['countries', 'languages', 'currencies'] where id = ${storeId}::uuid`);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${storeSlug}@example.com`}`);
  accountId = String(account.id);
  const form = new FormData();
  for (const [name, value] of Object.entries({ provider: "mistral", apiKey: "store-key", textModel: "mistral-small-latest" })) form.set(name, value);
  form.set("enabled", "on");
  expect(await ai.saveAiSettings(accountId, storeId, aiFormValues(form))).toEqual({ ok: true });

  kopp = await addPicture("kopp");
  lampe = await addPicture("lampe");
  beskrevet = await addPicture("beskrevet", { alt: "Staff's own words" });
  borte = await addPicture("borte");
  tegning = await addPicture("tegning", { type: "image/svg+xml" });
  film = await addPicture("film", { kind: "video", type: "video/mp4" });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

describe("alt texts written by the store's AI (D89)", () => {
  it("knows the store's name and languages, its main one first", async () => {
    const site = await altTexts.altSite(owner());
    expect(site?.name).toBe("Olas Butikk");
    expect(site?.languages[0]).toEqual({ locale: "nb-NO", name: "Norwegian Bokmål (Norway)" });
    // The store's languages, and English last for search and AI assistants.
    expect(site?.languages.map((language) => language.locale)).toEqual([
      ...new Set((await stores.getStore(storeSlug))!.markets.map((market) => market.locale)),
      "en",
    ]);
    expect(site?.languages.at(-1)).toEqual({ locale: "en", name: "English", extra: true });
    expect(await altTexts.altSite({ storeId: null, storeSlug: null })).toEqual({ name: "Kaizen", languages: [{ locale: "en", name: "English" }] });
  });

  it("writes every missing picture's, in each language, leaving staff's, videos and drawings alone", async () => {
    fakeAi();
    // Pictures only: the drawing counts, the video does not.
    expect(await altTexts.missingAltTexts(owner())).toBe(4);
    const since = new Date();
    const result = await altTexts.writeAltTexts(owner(), { since });
    // Three pictures are sent; the missing file fails on its own.
    expect(result).toMatchObject({ written: 2, failed: 1, remaining: 0 });
    expect(result.problem).toMatch(/could not be fetched \(404\)/);

    expect(await altOf(kopp.id)).toEqual({
      alt: "En hvit kopp på et trebord",
      translations: { "sv-SE": "En vit kopp på ett träbord", "da-DK": "En hvid kop på et træbord", en: "A white mug on a wooden table" },
      source: "ai",
    });
    // A colour is what a picture looks like; urgency is a claim, and that language is left out.
    expect(await altOf(lampe.id)).toEqual({
      alt: "En grønn bordlampe",
      translations: { "sv-SE": "En grön bordslampa", en: "A green desk lamp" },
      source: "ai",
    });
    expect(await altOf(beskrevet.id)).toEqual({ alt: "Staff's own words", translations: {}, source: "staff" });
    for (const untouched of [borte, tegning, film]) expect((await altOf(untouched.id)).source).toBeNull();

    // The model got the picture as bytes (Mistral's form), and the words about it.
    const first = asked.find((ask) => JSON.stringify(ask).includes("File name: kopp"))!;
    const parts = first.messages[1].content as { type: string; image_url?: unknown; text?: string }[];
    expect(String(parts.find((part) => part.type === "image_url")?.image_url)).toMatch(/^data:image\/png;base64,iVBOR/);
    expect(first.messages[0].content).toContain("Olas Butikk");
    expect(parts[0].text).toContain("nb-NO (Norwegian Bokmål (Norway))");

    // The same run finds nothing more: the missing one was tried.
    fakeAi();
    expect(await altTexts.writeAltTexts(owner(), { since })).toEqual({ written: 0, failed: 0, remaining: 0, problem: null });
    expect(asked).toHaveLength(0);
    expect(await altTexts.missingAltTexts(owner())).toBe(2);
  });

  it("writes the AI's texts again when the site gains a language, and waits a day on one it left out", async () => {
    // As though English were new: the kopp's texts lack it.
    await db().execute(sql`update commerce.media set alt_translations = alt_translations - 'en' where id = ${kopp.id}::uuid`);
    fakeAi();
    const result = await altTexts.writeAltTexts(owner(), { since: new Date(Date.now() - 24 * 60 * 60 * 1000) });
    expect(result.written).toBe(1);
    expect((await altOf(kopp.id)).translations).toMatchObject({ en: "A white mug on a wooden table" });
    // The lamp's Danish carried a claim: it is not asked again within the day.
    expect(asked.some((ask) => JSON.stringify(ask).includes("File name: lampe"))).toBe(false);
  });

  it("writes one picture again when asked, even staff's, and the AI's again in a new run only when asked", async () => {
    fakeAi();
    expect(await altTexts.writeAltText(owner(), beskrevet.id)).toEqual({ ok: false, problem: "Staff wrote this picture's alt text." });
    const again = await altTexts.writeAltText(owner(), beskrevet.id, { replace: true });
    expect(again.ok).toBe(false);
    // Nothing the stand-in knows about this name: nothing usable, and staff's words stay.
    expect((await altOf(beskrevet.id)).alt).toBe("Staff's own words");
    expect(await altTexts.writeAltText(owner(), film.id)).toEqual({ ok: false, problem: "Alt texts are written for pictures only." });

    fakeAi();
    const since = new Date(Date.now() + 1000);
    expect((await altTexts.writeAltTexts(owner(), { since, rewrite: true })).written).toBe(2);
  });

  it("stops at once when the model cannot see pictures, and says so", async () => {
    const extra = await addPicture("kopp-2");
    fakeAi();
    blind = true;
    try {
      const result = await altTexts.writeAltTexts(owner(), { since: new Date(Date.now() + 2000) });
      expect(result.written).toBe(0);
      expect(result.problem).toMatch(/could not look at the picture/);
      expect((await altOf(extra.id)).source).toBeNull();
    } finally {
      blind = false;
    }
  });

  it("describes pictures on the site that have no alt text of their own, in the shopper's language", async () => {
    // On a page.
    const content = {
      title: "Om oss",
      slug: `om-${run}`,
      thumbnail: null,
      seo: { title: "", description: "" },
      searchEngines: true,
      aiAssistants: true,
      categories: [],
      tags: [],
      rows: [
        {
          id: "r",
          type: "row",
          layout: "1",
          columns: [
            {
              id: "c",
              blocks: [
                { id: "a", type: "image", image: { url: `${base}/kopp-480.webp`, width: 480, height: 480, alt: "" }, caption: "" },
                { id: "b", type: "image", image: { url: lampe.url, width: 480, height: 480, alt: "Lampen vår" }, caption: "" },
              ],
            },
          ],
        },
      ],
    };
    await db().execute(sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${storeId}::uuid, ${`om-${run}`}, ${JSON.stringify(content)}::jsonb, ${JSON.stringify(content)}::jsonb, now())
    `);
    const found = await pages.findPublishedPage(storeId, `om-${run}`);
    const page = found && "page" in found ? found.page : null;
    const alts = (locale: string) =>
      localizePage(page!.content, locale).rows[0].columns[0].blocks.map((block) => (block.type === "image" ? block.image?.alt : null));
    expect(alts("nb-NO")).toEqual(["En hvit kopp på et trebord", "Lampen vår"]);
    expect(alts("sv-SE")).toEqual(["En vit kopp på ett träbord", "Lampen vår"]);

    // On a product: its own alt text first, else the library's in the market's language.
    const [product] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${storeId}::uuid and handle = 'demo-keramikkopp'`);
    await db().execute(sql`delete from commerce.product_media where product_id = ${String(product.id)}::uuid`);
    await db().execute(sql`
      insert into commerce.product_media (store_id, product_id, url, thumbnail_url, position, alt)
      values (${storeId}::uuid, ${String(product.id)}::uuid, ${kopp.url}, ${`${base}/kopp-480.webp`}, 0, '{}'),
             (${storeId}::uuid, ${String(product.id)}::uuid, ${lampe.url}, null, 1, '{"sv-SE": "Vår lampa"}')
    `);
    const swedish = await catalog.getProduct(storeId, toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" }), "demo-keramikkopp");
    expect(swedish?.images.map((image) => image.alt)).toEqual(["En vit kopp på ett träbord", "Vår lampa"]);
    const norwegian = await catalog.getProduct(storeId, toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" }), "demo-keramikkopp");
    expect(norwegian?.images.map((image) => image.alt)).toEqual(["En hvit kopp på et trebord", "En grønn bordlampe"]);
  });
});

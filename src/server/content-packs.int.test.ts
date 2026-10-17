import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { CONTENT_PACKS, PACK_KEYS, REAL_PHOTO, contentPack, packPrice, packSlots, packSlug } from "@/lib/content-packs";
import { inlinePlain } from "@/lib/inline-text";
import { parsePageContent } from "@/lib/page-content";

import type { Account } from "./auth";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

const packs = await import("./content-packs");
const { publishStarter } = await import("./store-starters");

/**
 * Kaizena Flow's content packs (`docs/theme-showcase-phase-1.md` step 2): `syncContentPacks()` writes each pack into a store template of its
 * own, a clean English store of its trade; `makeNextPackPicture()` fills its pictures one at a time; Publish waits for them.
 */

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let admin: Account;
let owner: Account;

const list = (values: readonly string[]) => `{${values.join(",")}}`;
/** A signature theme's art (`docs/signature-themes.md`) placed as Storage would keep it, without Storage; fonts as if installed. */
const artUrl = (url: string) => `https://example.invalid/art-${run}${url}`;
const deps = {
  storeArt: async (_owner: unknown, art: { url: string; width: number; height: number; alt: string }) => ({ ...art, url: artUrl(art.url), thumbnailUrl: null }),
  apply: { installFonts: async () => ({ ok: true as const }) },
};
const one = async (query: ReturnType<typeof sql>) => (await db().execute<Row>(query))[0];
const all = (query: ReturnType<typeof sql>) => db().execute<Row>(query);
const storeOf = async (key: string) => one(sql`
  select s.id, s.slug, s.name, s.locales, s.features, s.front_page_id, s.products_page_id, s.header_menu_id, s.footer_menu_id, ss.id as starter_id,
         ss.pack_version, ss.pack_pictures, ss.published, ss.title
  from commerce.store_starters ss join commerce.stores s on s.id = ss.store_id where ss.pack_key = ${key}
`);

beforeAll(async () => {
  const [a] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`packs-${run}@example.com`}, 'Platform', true) returning id, email
  `);
  admin = { id: String(a.id), email: String(a.email), name: "Platform", platformAdmin: true };
  owner = { id: admin.id, email: admin.email, name: "Owner", platformAdmin: false };
  // A database that ran this test before keeps the packs it made: set them aside, so this run makes its own.
  await db().execute(sql`
    update commerce.stores s set slug = left(s.slug, 20) || '-' || ${run}
    from commerce.store_starters ss where ss.store_id = s.id and ss.pack_key = any(${list(PACK_KEYS)}::text[])
  `);
  await db().execute(sql`update commerce.store_starters set pack_key = pack_key || '-' || ${run} where pack_key = any(${list(PACK_KEYS)}::text[])`);
});

afterAll(async () => {
  await closeDb();
});

describe("setting up the content packs", () => {
  it("is for Kaizena Flow's admins only", async () => {
    const result = await packs.syncContentPacks(owner);
    expect(result.problems).toHaveLength(1);
    expect(result.made).toEqual([]);
  });

  it("makes a store template of each pack, unpublished, at its own address", async () => {
    const result = await packs.syncContentPacks(admin, deps);
    expect(result.problems).toEqual([]);
    expect(result.made).toEqual(CONTENT_PACKS.map((pack) => pack.title));
    for (const pack of CONTENT_PACKS) {
      const store = await storeOf(pack.key);
      expect(store, pack.key).toBeDefined();
      expect(store.slug).toBe(packSlug(pack.key));
      expect(store.name).toBe(pack.storeName);
      expect(store.title).toBe(pack.title);
      expect(Number(store.pack_version)).toBe(pack.version);
      expect(store.published).toBe(false);
    }
    const states = await packs.contentPackStates();
    // Nothing is made yet: a signature theme's art only stands in until its photographs are made (D270).
    for (const state of states) expect(state.current && !state.published && state.pictures === 0, state.key).toBe(true);
  }, 240_000);

  it("writes each one as a clean English store of its trade: its products only, in English, priced in every market, with categories", async () => {
    for (const pack of CONTENT_PACKS) {
      const store = await storeOf(pack.key);
      const storeId = String(store.id);
      expect(store.locales).toEqual(["en-GB"]);
      // It sells where the template does, in one language; only the services pack books appointments.
      expect([...(store.features as string[])].sort()).toEqual(pack.key === "services" ? ["appointments", "countries", "shop"] : ["countries", "shop"]);
      const markets = await all(sql`select code, default_locale from commerce.markets where store_id = ${storeId}::uuid order by code`);
      expect(markets.length).toBeGreaterThan(0);
      expect(markets.every((m) => m.default_locale === "en-GB")).toBe(true);

      const active = await all(sql`select id, handle, kind, vat_category from commerce.products where store_id = ${storeId}::uuid and status = 'active' order by handle`);
      expect(active.map((p) => p.handle), pack.key).toEqual([...pack.products.map((p) => p.handle)].sort());
      for (const product of pack.products) {
        const row = active.find((p) => p.handle === product.handle)!;
        expect(row.kind).toBe(product.minutes ? "appointment" : "goods");
        expect(row.vat_category).toBe(pack.key === "food" ? "food" : "standard");
        const texts = await all(sql`select locale, title from commerce.product_translations where product_id = ${String(row.id)}::uuid`);
        expect(texts).toEqual([{ locale: "en-GB", title: product.title }]);
        const terms = await all(sql`
          select t.slug from commerce.product_terms pt join commerce.terms t on t.id = pt.term_id where pt.product_id = ${String(row.id)}::uuid
        `);
        expect(terms.map((t) => t.slug)).toEqual([product.category]);
        const prices = await all(sql`
          select market_code, amount_minor from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id
          where v.product_id = ${String(row.id)}::uuid order by market_code
        `);
        expect(prices.map((p) => [p.market_code, Number(p.amount_minor)])).toEqual(markets.map((m) => [m.code, packPrice(product.price, String(m.code))]));
        const [media] = await all(sql`select url from commerce.product_media where product_id = ${String(row.id)}::uuid`);
        const art = pack.art?.[`product:${product.handle}`];
        expect(media.url).toBe(art ? artUrl(art.url) : packs.PACK_PLACEHOLDER);
      }
      const categories = await all(sql`
        select slug, name from commerce.terms where store_id = ${storeId}::uuid and content_type = 'product' order by position
      `);
      expect(categories).toEqual(pack.categories.map((c) => ({ slug: c.slug, name: c.name })));
      const operators = await all(sql`select name, postal_address from commerce.economic_operators where store_id = ${storeId}::uuid order by country`);
      expect(operators.map((o) => o.name)).toEqual([`${pack.storeName} Demo AS`, `${pack.storeName} Demo AB`]);
      expect(operators.every((o) => !/Norge|Sverige|Danmark/.test(String(o.postal_address)))).toBe(true);
      // Nothing else of the template's demo is offered: its own products are archived, so no copy carries them.
      const others = await one(sql`select count(*)::int as n from commerce.products where store_id = ${storeId}::uuid and status <> 'archived' and not (handle = any(${list(pack.products.map((p) => p.handle))}::text[]))`);
      expect(others.n).toBe(0);
    }
  });

  it("gives each its home page (the front page), its about page and an English All products page, published", async () => {
    for (const pack of CONTENT_PACKS) {
      const store = await storeOf(pack.key);
      const pages = await all(sql`
        select id, slug, type, published from commerce.pages where store_id = ${String(store.id)}::uuid and type in ('page', 'article') order by slug
      `);
      expect(pages.map((p) => p.slug), pack.key).toEqual(["about", "all-products", "welcome"]);
      expect(pages.every((p) => p.published !== null)).toBe(true);
      const home = pages.find((p) => p.slug === "welcome")!;
      expect(String(store.front_page_id)).toBe(String(home.id));
      expect(String(store.products_page_id)).toBe(String(pages.find((p) => p.slug === "all-products")!.id));
      const content = parsePageContent(home.published)!;
      // The headline as a heading says it, its inline emphasis aside (a designed page may set a word in italics).
      const headings = content.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks)).flatMap((block) => (block.type === "heading" ? [inlinePlain(block.text)] : []));
      expect(headings, pack.key).toContain(pack.headline);
    }
  });

  it("gives a signature theme's pack its own designed pages and art, stored once, with links that are the store's", async () => {
    const pack = contentPack("astronomy")!;
    const store = await storeOf("astronomy");
    expect(store.name).toBe("Far Light");
    const kept = store.pack_pictures as Record<string, { url: string; art?: string }>;
    expect(Object.keys(kept).sort()).toEqual(Object.keys(pack.art!).sort());
    for (const [slot, picture] of Object.entries(pack.art!)) expect(kept[slot]).toMatchObject({ url: artUrl(picture.url), art: picture.url });
    const home = await one(sql`select published from commerce.pages where id = ${String(store.front_page_id)}::uuid`);
    const words = JSON.stringify(home.published);
    // Its own design (`ContentPack.design`), not the common home page, drawing its art; its paths are the store's own.
    expect(words).toContain("Fresh from the observatory");
    expect(words).toContain(artUrl(pack.art!.hero.url));
    expect(words).toContain('"href":"/products"');
    expect(words).toContain('"href":"/category/planets"');
    // A second sync of a newer version places nothing again: the art is kept by its address.
    await db().execute(sql`update commerce.store_starters set pack_version = null where id = ${String(store.starter_id)}::uuid`);
    let stored = 0;
    const again = await packs.syncContentPacks(admin, { ...deps, storeArt: async (owner, art) => (stored++, deps.storeArt(owner, art)) });
    expect(again.updated).toEqual([pack.title]);
    expect(stored).toBe(0);
  }, 120_000);

  it("dresses the signature pack in its theme once both are there, recommends it, and a second press adds nothing", async () => {
    const { syncLaunchThemes } = await import("./launch-themes");
    const { dressSignaturePacks } = await import("./signature-themes");
    expect((await syncLaunchThemes(admin, deps.apply)).problems).toEqual([]);
    expect(await dressSignaturePacks(admin, deps.apply)).toEqual([]);
    const store = await storeOf("astronomy");
    const installs = () => all(sql`
      select i.live, p.launch_key from commerce.store_theme_installs i left join commerce.design_presets p on p.id = i.preset_id
      where i.store_id = ${String(store.id)}::uuid
    `);
    const first = await installs();
    expect(first.filter((install) => install.live).map((install) => install.launch_key)).toEqual(["orbit"]);
    expect(await dressSignaturePacks(admin, deps.apply)).toEqual([]);
    expect(await installs()).toHaveLength(first.length);
    const starter = await one(sql`
      select ss.recommended_design, (select id from commerce.design_presets where launch_key = 'orbit') as orbit
      from commerce.store_starters ss where ss.id = ${String(store.starter_id)}::uuid
    `);
    expect(String(starter.recommended_design)).toBe(String(starter.orbit));
    const theme = await one(sql`select theme->'settings'->'dark'->>'background' as background, header_id from commerce.stores where id = ${String(store.id)}::uuid`);
    expect(theme.background).toBe("#070816");
    expect(theme.header_id).not.toBeNull();
  }, 240_000);

  it("writes its menus: home, the shop with its categories under it, and about", async () => {
    const pack = contentPack("fashion")!;
    const store = await storeOf("fashion");
    const header = await one(sql`select items from commerce.menus where id = ${String(store.header_menu_id)}::uuid`);
    const items = header.items as { label: Record<string, string>; link: { kind: string; slug?: string }; depth: number }[];
    expect(items.map((item) => item.label["en-GB"])).toEqual(["Home", "Shop", ...pack.categories.map((c) => c.name), "About"]);
    expect(items.filter((item) => item.depth === 1).map((item) => item.link.slug)).toEqual(pack.categories.map((c) => c.slug));
  });

  it("books the services pack's appointments with its two staff", async () => {
    const store = await storeOf("services");
    expect(store.features).toContain("appointments");
    const staff = await all(sql`select name from commerce.booking_resources where store_id = ${String(store.id)}::uuid order by position`);
    expect(staff.map((s) => s.name)).toEqual(["Anna", "Jonas"]);
    const links = await one(sql`
      select count(*)::int as n from commerce.product_resources pr join commerce.products p on p.id = pr.product_id
      where p.store_id = ${String(store.id)}::uuid and p.status = 'active'
    `);
    expect(links.n).toBe(contentPack("services")!.products.length * 2);
  });

  it("does nothing to a pack whose store has the code's version, and writes it again when it is older", async () => {
    const again = await packs.syncContentPacks(admin, deps);
    expect(again.current).toHaveLength(CONTENT_PACKS.length);
    expect(again.made.length + again.updated.length).toBe(0);

    const store = await storeOf("home");
    const pack = contentPack("home")!;
    await db().execute(sql`
      update commerce.product_translations t set title = 'Changed by hand' from commerce.products p
      where p.id = t.product_id and p.store_id = ${String(store.id)}::uuid and p.handle = ${pack.products[0].handle}
    `);
    await db().execute(sql`update commerce.store_starters set pack_version = null where id = ${String(store.starter_id)}::uuid`);
    const updated = await packs.syncContentPacks(admin, deps);
    expect(updated.updated).toEqual([pack.title]);
    const title = await one(sql`
      select t.title from commerce.product_translations t join commerce.products p on p.id = t.product_id
      where p.store_id = ${String(store.id)}::uuid and p.handle = ${pack.products[0].handle}
    `);
    expect(title.title).toBe(pack.products[0].title);
    const active = await one(sql`select count(*)::int as n from commerce.products where store_id = ${String(store.id)}::uuid and status = 'active'`);
    expect(active.n).toBe(pack.products.length);
  }, 120_000);
});

describe("a pack's pictures", () => {
  const connection = { image: { provider: "openai", apiUrl: "https://example.invalid", apiKey: "x", model: "picture", quality: null } } as never;
  let made = 0;
  const make = (async (_c: unknown, _o: unknown, request: { shape: string }) => {
    made++;
    const square = request.shape === "square";
    return { ok: true, picture: { url: `https://example.invalid/pack-${run}-${made}.webp`, thumbnailUrl: `https://example.invalid/pack-${run}-${made}-480.webp`, width: square ? 1024 : 1536, height: 1024 } };
  }) as never;

  it("are not made without a picture model, and the pack is not published without them", async () => {
    expect(await packs.makeNextPackPicture(admin, "beauty", { connection: null, make })).toMatchObject({ ok: false });
    expect(made).toBe(0);
    const store = await storeOf("beauty");
    const refused = await publishStarter(admin, String(store.starter_id));
    expect(refused).toMatchObject({ ok: false });
    expect(!refused.ok && refused.problems[0]).toMatch(/pictures first/);
  });

  it("are made one a request, in order, each put where it belongs, until none is missing", async () => {
    const pack = contentPack("beauty")!;
    const slots = packSlots(pack);
    const first = await packs.makeNextPackPicture(admin, "beauty", { connection, make });
    expect(first).toMatchObject({ ok: true, made: "hero", remaining: slots.length - 1 });
    let remaining = first.ok ? first.remaining : 0;
    while (remaining > 0) {
      const next = await packs.makeNextPackPicture(admin, "beauty", { connection, make });
      if (!next.ok) throw new Error(next.problems.join(" "));
      remaining = next.remaining;
    }
    expect(made).toBe(slots.length);
    expect(await packs.makeNextPackPicture(admin, "beauty", { connection, make })).toMatchObject({ ok: true, made: null, remaining: 0 });

    const store = await storeOf("beauty");
    expect(Object.keys(store.pack_pictures as object).sort()).toEqual([...slots].sort());
    const placeholders = await one(sql`
      select count(*)::int as n from commerce.product_media m join commerce.products p on p.id = m.product_id
      where p.store_id = ${String(store.id)}::uuid and p.status = 'active' and m.url = ${packs.PACK_PLACEHOLDER}
    `);
    expect(placeholders.n).toBe(0);
    const variants = await one(sql`
      select count(*)::int as n from commerce.product_variants v join commerce.products p on p.id = v.product_id
      where p.store_id = ${String(store.id)}::uuid and p.status = 'active' and v.image_url is null
    `);
    expect(variants.n).toBe(0);
    const home = await one(sql`select published from commerce.pages where id = ${String(store.front_page_id)}::uuid`);
    expect(JSON.stringify(home.published)).toContain(`pack-${run}-1.webp`);
    const states = await packs.contentPackStates();
    expect(states.find((s) => s.key === "beauty")).toMatchObject({ pictures: slots.length, slots: slots.length });
  }, 120_000);

  it("photograph a signature theme's demo store from its briefs at the model's best, in place of its art, which a later sync never puts back", async () => {
    const pack = contentPack("ceramics")!;
    const slots = packSlots(pack);
    const before = await storeOf("ceramics");
    expect(await publishStarter(admin, String(before.starter_id))).toMatchObject({ ok: false });
    const requests: { prompt: string; shape: string; quality?: string }[] = [];
    const shoot = (async (c: unknown, o: unknown, request: { prompt: string; shape: string; quality?: string }) => {
      requests.push(request);
      return (make as (c: unknown, o: unknown, r: unknown) => Promise<unknown>)(c, o, request);
    }) as never;
    let remaining = slots.length;
    while (remaining > 0) {
      const next = await packs.makeNextPackPicture(admin, "ceramics", { connection, make: shoot });
      if (!next.ok) throw new Error(next.problems.join(" "));
      remaining = next.remaining;
    }
    expect(requests).toHaveLength(slots.length);
    expect(requests[0]).toMatchObject({ shape: "landscape", quality: "high" });
    expect(requests[0].prompt).toContain(pack.photos!.hero.brief);
    expect(requests.at(-1)).toMatchObject({ shape: "portrait" });
    for (const request of requests) expect(request.prompt).toContain(REAL_PHOTO);
    const store = await storeOf("ceramics");
    const kept = store.pack_pictures as Record<string, { url: string; art?: string }>;
    for (const slot of slots) expect(kept[slot]?.art, slot).toBeUndefined();
    // The designed home page shows the photographs, no longer the art.
    const home = await one(sql`select published from commerce.pages where id = ${String(store.front_page_id)}::uuid`);
    expect(JSON.stringify(home.published)).toContain(kept.hero.url);
    expect(JSON.stringify(home.published)).not.toContain(artUrl(pack.art!.hero.url));
    // A later sync of a newer version keeps them: no art is stored again or put back.
    await db().execute(sql`update commerce.store_starters set pack_version = null where id = ${String(store.starter_id)}::uuid`);
    let stored = 0;
    await packs.syncContentPacks(admin, { ...deps, storeArt: async (owner, art) => (stored++, deps.storeArt(owner, art)) });
    expect(stored).toBe(0);
    expect((await storeOf("ceramics")).pack_pictures).toEqual(kept);
    const states = await packs.contentPackStates();
    expect(states.find((s) => s.key === "ceramics")).toMatchObject({ pictures: slots.length, slots: slots.length });
  }, 240_000);

  it("let the pack be published, and its copy holds the pack alone, in English", async () => {
    const store = await storeOf("beauty");
    const published = await publishStarter(admin, String(store.starter_id));
    expect(published).toMatchObject({ ok: true });
    const copy = await one(sql`select s.id, s.locales from commerce.store_starters ss join commerce.stores s on s.id = ss.published_store_id where ss.id = ${String(store.starter_id)}::uuid`);
    expect(copy.locales).toEqual(["en-GB"]);
    const handles = await all(sql`select handle from commerce.products where store_id = ${String(copy.id)}::uuid and status = 'active' order by handle`);
    expect(handles.map((p) => p.handle)).toEqual([...contentPack("beauty")!.products.map((p) => p.handle)].sort());
    const others = await one(sql`select count(*)::int as n from commerce.products where store_id = ${String(copy.id)}::uuid and status <> 'active'`);
    expect(others.n).toBe(0);
  }, 120_000);
});

describe("the picture job (D271)", () => {
  const connection = { image: { provider: "openai", apiUrl: "https://example.invalid", apiKey: "x", model: "picture", quality: null } } as never;
  let made = 0;
  const make = (async () => {
    made++;
    return { ok: true, picture: { url: `https://example.invalid/job-${run}-${made}.webp`, thumbnailUrl: null, width: 1536, height: 1024 } };
  }) as never;
  const refuse = (async () => ({ ok: false, problem: "The picture model is busy." })) as never;
  const soon = () => Date.now() + 60_000;
  const wish = async (key: string) =>
    one(sql`select pictures_wanted_by, pictures_wanted_at, picture_claimed_until, picture_failures, picture_problem from commerce.store_starters where pack_key = ${key}`);

  beforeAll(async () => {
    // Packs set aside from an earlier run of this test are asked for by no one.
    await db().execute(sql`
      update commerce.store_starters set pictures_wanted_by = null, pictures_wanted_at = null, picture_claimed_until = null
      where pack_key is not null and pack_key <> all(${list(PACK_KEYS)}::text[])
    `);
  });

  it("is asked for by Kaizena Flow's admins only, for packs that lack pictures", async () => {
    expect(await packs.askForPackPictures(owner, ["fashion"])).toMatchObject({ ok: false });
    expect((await wish("fashion")).pictures_wanted_at).toBeNull();
    // Beauty has every picture: nothing to ask for.
    expect(await packs.askForPackPictures(admin, ["beauty"])).toMatchObject({ ok: false });
    expect(await packs.askForPackPictures(admin, ["fashion", "beauty"])).toEqual({ ok: true, asked: [contentPack("fashion")!.title] });
    expect(await wish("fashion")).toMatchObject({ pictures_wanted_by: admin.id, picture_failures: 0, picture_problem: null });
    expect((await packs.contentPackStates()).find((s) => s.key === "fashion")).toMatchObject({ asked: true, problem: null });
  });

  it("makes the pictures asked for in the asker's name until none is missing, then forgets the wish", async () => {
    const slots = packSlots(contentPack("fashion")!);
    const result = await packs.runPackPictures(soon(), { connection, make });
    expect(result).toMatchObject({ made: slots.length, failed: 0 });
    expect(result.stores.map((store) => store.slug)).toEqual([packSlug("fashion")]);
    expect(await wish("fashion")).toMatchObject({ pictures_wanted_by: null, pictures_wanted_at: null, picture_claimed_until: null });
    expect((await packs.contentPackStates()).find((s) => s.key === "fashion")).toMatchObject({ pictures: slots.length, asked: false });
    // Nothing is asked for: a run makes nothing.
    expect(await packs.runPackPictures(soon(), { connection, make })).toMatchObject({ made: 0, failed: 0 });
  }, 120_000);

  it("waits a little after a failure, stops after three in a row with the reason, and starts over when asked again", async () => {
    expect(await packs.askForPackPictures(admin, ["food"])).toMatchObject({ ok: true });
    // One try a run: the failed pack is held a while before the next.
    expect(await packs.runPackPictures(soon(), { connection, make: refuse })).toMatchObject({ made: 0, failed: 1 });
    const held = await wish("food");
    expect(held).toMatchObject({ picture_failures: 1, picture_problem: "The picture model is busy." });
    expect(held.pictures_wanted_at).not.toBeNull();
    expect(new Date(String(held.picture_claimed_until)).getTime()).toBeGreaterThan(Date.now());
    for (let tries = 2; tries <= packs.PICTURE_TRIES; tries++) {
      await db().execute(sql`update commerce.store_starters set picture_claimed_until = null where pack_key = 'food'`);
      expect(await packs.runPackPictures(soon(), { connection, make: refuse })).toMatchObject({ failed: 1 });
    }
    expect(await wish("food")).toMatchObject({ pictures_wanted_at: null, picture_failures: packs.PICTURE_TRIES, picture_problem: "The picture model is busy." });
    expect((await packs.contentPackStates()).find((s) => s.key === "food")).toMatchObject({ asked: false, problem: "The picture model is busy." });
    expect(await packs.askForPackPictures(admin, ["food"])).toMatchObject({ ok: true });
    expect(await wish("food")).toMatchObject({ picture_failures: 0, picture_problem: null });
  });

  it("makes two packs' pictures at a time at most, and Stop ends a pack's", async () => {
    expect(await packs.askForPackPictures(admin, ["home", "electronics"])).toMatchObject({ ok: true });
    // Two packs are held by other runs: this one takes none.
    await db().execute(sql`update commerce.store_starters set picture_claimed_until = null where pack_key = 'food'`);
    await db().execute(sql`update commerce.store_starters set picture_claimed_until = now() + interval '1 minute' where pack_key in ('home', 'electronics')`);
    expect(await packs.runPackPictures(soon(), { connection, make })).toMatchObject({ made: 0, failed: 0 });
    await db().execute(sql`update commerce.store_starters set picture_claimed_until = null where pack_key in ('home', 'electronics')`);
    expect(await packs.stopPackPictures(owner, "food")).toMatchObject({ ok: false });
    for (const key of ["food", "home", "electronics"]) expect(await packs.stopPackPictures(admin, key)).toEqual({ ok: true });
    expect((await wish("food")).pictures_wanted_at).toBeNull();
    expect(await packs.runPackPictures(soon(), { connection, make })).toMatchObject({ made: 0 });
  });

  it("stops for an admin who is no longer one, and says so", async () => {
    const [former] = await db().execute<Row>(sql`
      insert into commerce.accounts (email, name, platform_admin) values (${`packs-former-${run}@example.com`}, 'Former', true) returning id, email
    `);
    const formerAdmin = { id: String(former.id), email: String(former.email), name: "Former", platformAdmin: true };
    expect(await packs.askForPackPictures(formerAdmin, ["home"])).toMatchObject({ ok: true });
    await db().execute(sql`update commerce.accounts set platform_admin = false where id = ${formerAdmin.id}::uuid`);
    expect(await packs.runPackPictures(soon(), { connection, make })).toMatchObject({ made: 0, failed: 1 });
    expect(String((await wish("home")).picture_problem)).toMatch(/no longer one of Kaizena Flow's admins/);
    await packs.stopPackPictures(admin, "home");
  });
});

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, expect, test, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { PackPicture } from "@/lib/content-pack-pages";
import { contentPack, packSlots, slotMissing, type PackKey } from "@/lib/content-packs";
import { parsePageContent } from "@/lib/page-content";
import type { Account } from "@/server/auth";

/**
 * A store on the Orbit launch theme for the end-to-end build (bloat review step 1.6): CI runs this before `pnpm build`, so the
 * storefront's prerendered pages include a store that wears a theme whole (its content pack, header, footer, product layout, two font
 * families and photographs with their stored sizes), and e2e/performance.spec.ts holds its pages. It runs the platform's own functions,
 * as `src/server/theme-store.int.test.ts` does: the content packs, the launch themes, the theme's own content published, and a demo
 * store made from them (`createDemoStore()`, which makes a store from a theme and its content with no session; self sign-up needs a
 * claimed access request). Two things CI cannot reach are fixtures: Google Fonts (the two families' latin files are in
 * e2e/fixtures/fonts, installed through the real `installFont()` with a canned stylesheet) and Supabase storage (the theme's art is
 * resized with sharp into public/e2e-orbit/, which git ignores, and kept in the media library as an upload would leave it). Safe to run
 * twice: a database that has the store already is left as it is.
 */

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const { makeNextPackPicture, syncContentPacks } = await import("@/server/content-packs");
const { syncLaunchThemes } = await import("@/server/launch-themes");
const { publishStarter } = await import("@/server/store-starters");
const { createDemoStore, publishDemoStore } = await import("@/server/demo-stores");
const { installFont } = await import("@/server/fonts");

type Row = Record<string, unknown>;

const SLUG = "e2e-orbit";
const FAMILIES = ["Unbounded", "Manrope"];
const REPO = process.cwd();
const OUT = path.join(REPO, "public", SLUG);
/**
 * The address the end-to-end server answers at (playwright.config.ts's PORT): a page's pictures are full addresses, as storage's are, so
 * the files are the server's own public ones. Seed with the PORT the tests will run with.
 */
const BASE = `http://localhost:${process.env.PORT ?? 3000}`;

/** Google's stylesheet for one family's latin file, as Google writes it (`parseGoogleCss()` reads the comment and the address). */
const googleCss = (family: string) =>
  `/* latin */\n@font-face {\n font-family: '${family}';\n font-style: normal;\n font-weight: 200 800;\n font-display: swap;\n src: url(https://fonts.gstatic.com/e2e/${family}.woff2) format('woff2');\n unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;\n}\n`;

/** Google Fonts as the fixtures answer it: the stylesheet, then the family's latin file from e2e/fixtures/fonts. */
async function fixtureFetcher(url: string): Promise<Response> {
  if (url.startsWith("https://fonts.googleapis.com/css2")) {
    const family = decodeURIComponent(new URL(url).searchParams.get("family") ?? "").split(":")[0];
    return new Response(googleCss(family));
  }
  const file = /^https:\/\/fonts\.gstatic\.com\/e2e\/([A-Za-z]+)\.woff2$/.exec(url)?.[1];
  if (file) return new Response(new Uint8Array(await readFile(path.join(REPO, "e2e/fixtures/fonts", `${file}.woff2`))));
  return new Response(null, { status: 404 });
}

/**
 * The fonts a theme or a page needs: Orbit's two families installed through the real installer from the fixtures. The other launch themes
 * and packs, which the sync writes too but no budget measures, name families with no fixture: those are passed over as the integration
 * tests' stub passes every family (`src/server/theme-store.int.test.ts`), and nothing is stored for them.
 */
async function fixtureFonts(families: string[]): Promise<{ ok: true } | { ok: false; problem: string }> {
  for (const family of new Set(families)) {
    if (!FAMILIES.includes(family)) continue;
    const installed = await installFont(family, fixtureFetcher);
    if (!installed.ok) return installed;
  }
  return { ok: true };
}

/** A file in storage, as the copy names it: the fixture's bucket path is the public file itself, at the server's own address. */
const deps = { installFonts: fixtureFonts, copyFile: async (_bucket: string, from: string) => `${BASE}/${from}` };

/**
 * A picture kept in a store's media library as storage would keep it, without storage: three sizes made with sharp in public/e2e-orbit/,
 * named after their theme (each theme's art has the same names, and the library keeps one row per address), and one media row.
 */
async function keepPicture(storeId: string, art: PackPicture, prefix: string): Promise<{ url: string; thumbnailUrl: string; width: number; height: number }> {
  const [, theme, base] = /^\/demo\/themes\/([a-z0-9-]+)\/([a-z0-9-]+)\.webp$/.exec(art.url) ?? [];
  if (!theme || !base) throw new Error(`${art.url} is not a theme's art file.`);
  const name = `${theme}-${prefix}${base}`;
  const source = await readFile(path.join(REPO, "public", art.url));
  await mkdir(OUT, { recursive: true });
  const file = (suffix: string) => `${SLUG}/${name}${suffix}.webp`;
  const at = (suffix: string) => `${BASE}/${file(suffix)}`;
  const write = (width: number, suffix: string) =>
    sharp(source).resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(REPO, "public", file(suffix)));
  const large = await write(1600, "");
  await write(800, "-800");
  await write(480, "-480");
  await db().execute(sql`
    insert into commerce.media (store_id, kind, url, thumbnail_url, medium_url, bucket, path, file_name, content_type, width, height)
    values (${storeId}::uuid, 'image', ${at("")}, ${at("-480")}, ${at("-800")}, 'product-media', ${file("")}, ${`${name}.webp`},
      'image/webp', ${art.width}, ${art.height})
  `);
  return { url: at(""), thumbnailUrl: at("-480"), width: large.width, height: large.height };
}

/** A theme's art in its pack store's library (`PackDeps.storeArt`, in place of `storeArtPicture()`, which needs storage). */
async function fixtureArt(owner: { storeId: string; accountId: string }, art: PackPicture) {
  const kept = await keepPicture(owner.storeId, art, "");
  return { ...art, url: kept.url, thumbnailUrl: kept.thumbnailUrl };
}

/**
 * Orbit's pack is published only once its photographs are made (D270), which Kaizena Flow's picture model does: here each photograph is
 * the slot's own art, kept as a new file of the library (`makeNextPackPicture()`'s `make`, in place of `makePicture()`). The slot comes
 * first from the pack's data, as `makeNextPackPicture()` takes it.
 */
const PICTURE_MODEL = { image: { provider: "openai", apiUrl: "https://example.invalid", apiKey: "x", model: "picture", quality: null } } as never;

async function photographPack(admin: Account, key: PackKey): Promise<void> {
  const pack = contentPack(key)!;
  for (let tries = 0; tries < 40; tries++) {
    const [row] = await db().execute<Row>(sql`select store_id, pack_pictures from commerce.store_starters where pack_key = ${key}`);
    const kept = (row.pack_pictures ?? {}) as Record<string, unknown>;
    const slot = packSlots(pack).find((s) => slotMissing(pack, s, kept[s]));
    if (!slot) return;
    const art = pack.art?.[slot];
    if (!art) throw new Error(`${key}: no art stands in for the photograph of ${slot}`);
    const make = (async () => ({ ok: true, picture: await keepPicture(String(row.store_id), art, "photo-") })) as never;
    const made = await makeNextPackPicture(admin, key, { connection: PICTURE_MODEL, make, apply: deps });
    if (!made.ok) throw new Error(`${key}: ${made.problems.join(" ")}`);
    expect(made.made).toBe(slot);
  }
  throw new Error(`${key}: its photographs never ran out`);
}

afterAll(async () => {
  await closeDb();
});

test("seeds the Orbit store", async () => {
  const [existing] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${SLUG}`);
  if (existing) return;

  // (1) A platform admin, who makes the store as the platform's Themes page would.
  await db().execute(sql`insert into commerce.accounts (email, name, platform_admin) values ('e2e-seed@example.com', 'Seed', true) on conflict do nothing`);
  const [row] = await db().execute<Row>(sql`select id, email from commerce.accounts where lower(email) = 'e2e-seed@example.com'`);
  const admin = { id: String(row.id), email: String(row.email), name: "Seed", platformAdmin: true } as Account;

  // (2, 3) The content packs with their art, then the launch themes: Orbit takes the astronomy pack as its own content.
  const packs = await syncContentPacks(admin, { storeArt: fixtureArt, apply: deps });
  expect(packs.problems).toEqual([]);
  expect((await syncLaunchThemes(admin, deps)).problems).toEqual([]);

  // (4) Orbit and its content, published as the platform's Publish does, so a store can start from it.
  const [orbit] = await db().execute<Row>(sql`select id from commerce.design_presets where launch_key = 'orbit'`);
  expect(orbit).toBeDefined();
  const presetId = String(orbit.id);
  const [content] = await db().execute<Row>(sql`select id, store_id, published from commerce.store_starters where design_preset_id = ${presetId}::uuid`);
  expect(content, "Orbit's content is linked to its theme").toBeDefined();
  const starterId = String(content.id);
  const [art] = await db().execute<Row>(sql`select count(*)::int as n from commerce.media where store_id = ${String(content.store_id)}::uuid`);
  expect(Number(art.n), "the pack's art in its template's library").toBeGreaterThanOrEqual(8);
  if (!content.published) {
    await photographPack(admin, "astronomy");
    const published = await publishStarter(admin, starterId);
    expect(published, JSON.stringify(published)).toMatchObject({ ok: true });
  }

  // (5) The store: a demo store wearing Orbit on its own content, published.
  const made = await createDemoStore(admin, { name: "Orbit Test", slug: SLUG, look: { id: presetId, variation: null }, contentId: starterId }, deps);
  if (!made.ok) throw new Error(`createDemoStore refused: ${made.problems.join(" ")}`);
  expect(made.themed, made.notes.join(" ")).toBe(true);
  expect(await publishDemoStore(admin, made.id)).toEqual({ ok: true });

  // (7) Open to visitors, as e2e/global-setup.ts opens the test database's stores.
  await db().execute(sql`update commerce.stores set private_mode = false, setup_completed_at = now() where slug = ${SLUG}`);

  // (8) A store dressed whole, or the seed fails here rather than in a budget.
  const [store] = await db().execute<Row>(sql`
    select s.id, s.header_id, s.footer_id, s.product_layout_id, p.published as home
    from commerce.stores s left join commerce.pages p on p.id = s.front_page_id and p.store_id = s.id and p.published_at is not null
    where s.slug = ${SLUG}
  `);
  expect(parsePageContent(store.home)?.rows, "the home page's rows").toHaveLength(6);
  const storeId = String(store.id);
  const layouts = await db().execute<Row>(sql`
    select type from commerce.pages
    where store_id = ${storeId}::uuid and published_at is not null
      and id = any(array[${store.header_id}, ${store.footer_id}, ${store.product_layout_id}]::uuid[])
  `);
  expect(layouts.map((layout) => String(layout.type)).sort()).toEqual(["footer", "header", "product_layout"]);
  const [fonts] = await db().execute<Row>(sql`select count(*)::int as n from commerce.fonts where family in ('Unbounded', 'Manrope') and css ~ '\\S'`);
  expect(Number(fonts.n)).toBe(FAMILIES.length);
  // A copied store draws its content's library files: a picture's copies are found by its address (`catalog.ts`, `media-alts.ts`).
  const [copies] = await db().execute<Row>(sql`
    select count(distinct md.id)::int as n from commerce.media md
    where md.thumbnail_url is not null and md.medium_url is not null
      and (md.url in (select pm.url from commerce.product_media pm where pm.store_id = ${storeId}::uuid)
        or exists (select 1 from commerce.pages p where p.store_id = ${storeId}::uuid and p.published_at is not null and strpos(p.published::text, md.url) > 0))
  `);
  expect(Number(copies.n), "the store's photographs with their copies").toBeGreaterThanOrEqual(8);
});

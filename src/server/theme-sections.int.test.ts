import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { contentPack } from "@/lib/content-packs";
import { LAUNCH_THEMES } from "@/lib/launch-themes";

import type { Account } from "./auth";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

const sections = await import("./theme-sections");
const { syncLaunchThemes } = await import("./launch-themes");

/**
 * A theme's own sections in the page builder (D272): offered while a signature theme is live, placed with words for any store and the
 * theme's demo store's pictures copied into the store's own library.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const files = "https://files.example.com/storage/v1/object/public";
const atelier = LAUNCH_THEMES.find((theme) => theme.key === "atelier")!;
const pack = contentPack(atelier.content)!;

let admin: Account;
let store: string;
let plain: string;
let packStore: string;
const heroUrl = () => `${files}/product-media/${packStore}/${run}-hero.webp`;

const one = async (query: ReturnType<typeof sql>) => (await db().execute<Row>(query))[0];
const newStore = async (slug: string, starter = false) =>
  String((await one(sql`insert into commerce.stores (slug, name, starter) values (${`${slug}-${run}`}, ${slug}, ${starter}) returning id`)).id);

beforeAll(async () => {
  const [a] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`sections-${run}@example.com`}, 'Platform', true) returning id, email
  `);
  admin = { id: String(a.id), email: String(a.email), name: "Platform", platformAdmin: true };
  store = await newStore("sections");
  plain = await newStore("sections-plain");
  // Atelier as Kaizena Flow keeps it (synced as the launch themes are, fonts as if installed), live on the store.
  const synced = await syncLaunchThemes(admin, { installFonts: async () => ({ ok: true as const }) });
  if (synced.problems.length > 0) throw new Error(synced.problems.join(" "));
  const preset = String((await one(sql`select id from commerce.design_presets where launch_key = 'atelier'`)).id);
  await db().execute(sql`update commerce.store_theme_installs set live = false, look = '{}'::jsonb where store_id = ${store}::uuid and live`);
  await db().execute(sql`insert into commerce.store_theme_installs (store_id, preset_id, title, live) values (${store}::uuid, ${preset}::uuid, 'Atelier', true)`);
  // Its demo store, with its hero made and kept in its library; a pack this test did not make is set aside.
  await db().execute(sql`
    update commerce.stores s set slug = left(s.slug, 20) || '-' || ${run}
    from commerce.store_starters ss where ss.store_id = s.id and ss.pack_key = ${pack.key}
  `);
  await db().execute(sql`update commerce.store_starters set pack_key = pack_key || '-' || ${run} where pack_key = ${pack.key}`);
  packStore = await newStore("sections-pack", true);
  const hero = { url: heroUrl(), width: 1600, height: 1000, alt: "A still life" };
  await db().execute(sql`
    insert into commerce.store_starters (store_id, title, category, pack_key, pack_version, pack_pictures)
    values (${packStore}::uuid, 'Ceramics', 'retail', ${pack.key}, 1, ${JSON.stringify({ hero })}::jsonb)
  `);
  const path = `${packStore}/${run}-hero.webp`;
  await db().execute(sql`
    insert into commerce.media (store_id, kind, url, thumbnail_url, bucket, path, thumbnail_path, file_name, content_type, size_bytes, width, height)
    values (${packStore}::uuid, 'image', ${heroUrl()}, ${`${files}/product-media/${path}-480`}, 'product-media', ${path}, ${`${path}-480`},
      ${`hero-${run}.webp`}, 'image/webp', 1000, 1600, 1000)
  `);
}, 240_000);

afterAll(async () => {
  await closeDb();
});

describe("a theme's sections in the builder", () => {
  it("are offered while a signature theme is live, each with the picture its tile shows", async () => {
    expect(await sections.themeSectionsFor(plain)).toBeNull();
    const offer = await sections.themeSectionsFor(store);
    expect(offer?.theme).toBe(atelier.title);
    const keys = atelier.sections!(() => null).map((section) => section.key);
    expect(offer?.sections.map((section) => section.key)).toEqual(keys);
    // The made picture where there is one, else the theme's art from the site's own files, as a full address.
    expect(offer?.sections.find((section) => section.key === "hero")?.thumb).toBe(heroUrl());
    const art = offer?.sections.find((section) => section.thumb && section.thumb !== heroUrl())?.thumb;
    expect(art).toMatch(/^https?:\/\/[^/]+\/demo\/themes\/atelier\/[a-z0-9-]+\.webp$/);
  });

  it("place one with words for any store and its pictures copied into the store's library, audited", async () => {
    const copied: string[] = [];
    const copyFile = async (bucket: string, _from: string, to: string) => {
      copied.push(to);
      return `${files}/${bucket}/${to}`;
    };
    const result = await sections.placeThemeSection(store, admin, "hero", { copyFile });
    if (!result.ok) throw new Error(result.problem);
    expect(result.part.kind).toBe("row");
    const words = JSON.stringify(result.part.content);
    expect(words).not.toContain(pack.storeName);
    expect(words).not.toContain(heroUrl());
    expect(copied.length).toBeGreaterThan(0);
    expect(words).toContain(`${files}/product-media/${copied[0]}`);
    const kept = await one(sql`select count(*)::int as n from commerce.media where store_id = ${store}::uuid and url = ${`${files}/product-media/${copied[0]}`}`);
    expect(kept.n).toBe(1);
    const logged = await one(sql`select details from commerce.audit_log where store_id = ${store}::uuid and action = 'store.theme_section_used' order by created_at desc limit 1`);
    expect(logged.details).toMatchObject({ theme: "atelier", section: "hero", media: 1 });
  });

  it("keep the theme's art as a full address where its demo store has no picture of the slot", async () => {
    const result = await sections.placeThemeSection(store, admin, "collections", { copyFile: async () => null });
    if (!result.ok) throw new Error(result.problem);
    expect(JSON.stringify(result.part.content)).toMatch(/https?:\/\/[^"]+\/demo\/themes\/atelier\/[a-z0-9-]+\.webp/);
  });

  it("refuse a section the theme does not have, and a store whose theme has none", async () => {
    expect(await sections.placeThemeSection(store, admin, "nope")).toMatchObject({ ok: false });
    expect(await sections.placeThemeSection(plain, admin, "hero")).toMatchObject({ ok: false });
  });
});

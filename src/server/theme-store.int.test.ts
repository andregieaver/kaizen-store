import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { LAUNCH_THEMES } from "@/lib/launch-themes";
import { sharePicture } from "@/lib/theme-store";

import type { Account } from "./auth";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const { syncLaunchThemes } = await import("./launch-themes");
const designs = await import("./design-presets");
const store = await import("./theme-store");
const installs = await import("./theme-installs");
const { mediaUses } = await import("./media-library");

/**
 * The theme store's data (`docs/theme-phase-3.md` step 1): launch themes listed at their key, an admin's listing saved at once and refused
 * for an address another theme has, and the store's reads showing only published, unarchived themes with an address, with a changelog.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const deps = { installFonts: async () => ({ ok: true as const }) };
let admin: Account;

beforeAll(async () => {
  const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`store-${run}@example.com`}, 'Lister', true) returning id, email`);
  admin = { id: String(row.id), email: String(row.email), name: "Lister", platformAdmin: true } as Account;
  expect((await syncLaunchThemes(admin, deps)).problems).toEqual([]);
});

afterAll(async () => {
  await closeDb();
});

describe("the theme store's data", () => {
  it("lists the launch themes at their keys, with their listings", async () => {
    const cards = await store.themeStoreCards();
    const calm = cards.find((card) => card.slug === "calm");
    expect(calm?.title).toBe("Calm");
    expect(cards.find((card) => card.slug === "hearth")?.listing).toEqual({
      kinds: ["food", "home", "crafts"],
      styles: ["warm", "classic"],
      pictures: [],
      pack: "food",
      presetPacks: { blush: "beauty", olive: "home" },
      // Its highlights' words are the code's (`docs/theme-showcase-phase-2.md` step 2).
      highlights: LAUNCH_THEMES.find((t) => t.key === "hearth")!.listing.highlights,
    });
    expect(calm?.features).toContain("dark");
  });

  it("draws a theme's page with what it includes and its changelog, and nothing for an unknown address", async () => {
    const page = await store.themeStorePage("fjord");
    expect(page?.sectionStyles).toEqual(expect.arrayContaining(["Plain", "Hero", "Quote"]));
    expect(page?.changelog.at(-1)?.lines).toEqual(["The first version."]);
    expect(page?.version).toBeGreaterThanOrEqual(1);
    expect(await store.themeStorePage(`nothing-${run}`)).toBeNull();
  });

  it("keeps a launch theme's pictures, which are the admin's, when the code's listing is written again", async () => {
    const hearth = await store.themeStorePage("hearth");
    if (!hearth) throw new Error("Hearth is not in the store");
    expect(await designs.saveThemeListing(admin, hearth.id, "hearth", { kinds: [], styles: [], pictures: ["/media/hearth-1.webp"], pack: null, presetPacks: {} })).toEqual({ ok: true });
    await syncLaunchThemes(admin, deps);
    const after = await store.themeStorePage("hearth");
    expect(after?.listing).toEqual({
      kinds: ["food", "home", "crafts"],
      styles: ["warm", "classic"],
      pictures: ["/media/hearth-1.webp"],
      pack: "food",
      presetPacks: { blush: "beauty", olive: "home" },
      highlights: LAUNCH_THEMES.find((t) => t.key === "hearth")!.listing.highlights,
    });
  });

  it("saves an admin's listing, refuses another theme's address, and shows a theme only while it is published", async () => {
    const made = await designs.createDesign(admin, { details: { title: `Listed ${run}`, summary: "", description: "", pictureUrl: null }, origin: { kind: "scratch" } }, deps);
    if (!made.ok) throw new Error(made.problems.join(" "));
    expect(await designs.saveThemeListing(admin, made.id, "calm", { kinds: [], styles: [], pictures: [], pack: null, presetPacks: {} })).toEqual({ ok: false, problems: ["Another theme has that address. Choose another."] });
    const slug = `listed-${run}`;
    expect(await designs.saveThemeListing(admin, made.id, slug, { kinds: ["food"], styles: ["warm"], pictures: ["/media/one.webp"], pack: null, presetPacks: {} })).toEqual({ ok: true });
    // Not published yet: not in the store.
    expect((await store.themeStoreCards()).some((card) => card.slug === slug)).toBe(false);
    expect((await designs.publishDesign(admin, made.id)).ok).toBe(true);
    expect((await store.themeStoreCards()).find((card) => card.slug === slug)?.listing).toEqual({ kinds: ["food"], styles: ["warm"], pictures: ["/media/one.webp"], pack: null, presetPacks: {} });
    // Unpublished: gone again.
    expect((await designs.unpublishDesign(admin, made.id)).ok).toBe(true);
    expect(await store.themeStorePage(slug)).toBeNull();
  });
});

describe("trying a theme in a store (step 2)", () => {
  it("adds it to the store's themes without going live, so visitors see nothing, and counts the store as using it", async () => {
    const email = `trier-${run}@example.com`;
    const slug = `trier-${run}`;
    const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Owner', ${slug}) returning id`);
    const [{ id: storeId }] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${slug}, null) as id`);
    const [{ id: ownerId }] = await db().execute<Row>(sql`select id from commerce.accounts where lower(email) = lower(${email})`);
    const columns = sql`select theme, custom_css, header_id, footer_id, product_layout_id from commerce.stores where id = ${String(storeId)}::uuid`;
    const before = (await db().execute<Row>(columns))[0];
    const hearth = await store.themeStorePage("hearth");
    if (!hearth) throw new Error("Hearth is not in the store");
    expect(await installs.storesWithTheme(hearth.id, [slug])).toEqual(new Set());

    const added = await designs.installDesignPreset(String(storeId), hearth.id, String(ownerId), deps);
    if (!added.ok) throw new Error(added.problems.join(" "));
    expect(added.title).toBe("Hearth");
    // The store's look columns, which every page reads, are as they were; the new install is not live and keeps its look in its row.
    expect((await db().execute<Row>(columns))[0]).toEqual(before);
    const list = await installs.listInstalls(String(storeId));
    expect(list.find((install) => install.id === added.installId)?.live).toBe(false);
    expect(list.filter((install) => install.live)).toHaveLength(1);
    expect(await installs.storesWithTheme(hearth.id, [slug, `nobody-${run}`])).toEqual(new Set([slug]));
    const [{ uses }] = await db().execute<Row>(sql`select count(*)::int as uses from commerce.design_preset_uses where store_id = ${String(storeId)}::uuid`);
    expect(uses).toBe(0);
    const row = (await designs.listDesigns()).find((design) => design.id === hearth.id);
    expect(row?.storesUsing).toBeGreaterThanOrEqual(1);

    // Someone who does not work in the store cannot add one.
    const [outsider] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`outsider-${run}@example.com`}, 'Out') returning id`);
    const other = await designs.installDesignPreset(String(storeId), hearth.id, String(outsider.id), deps);
    expect(other.ok).toBe(false);
  });
});

describe("pictures in place of made ones (docs/theme-showcase-phase-2.md step 3)", () => {
  it("puts the admin's own picture in a made one's place and back, audited, kept by the listing form and the launch sync", async () => {
    const signal = await store.themeStorePage("signal");
    if (!signal) throw new Error("Signal is not in the store");
    const [kept] = await db().execute<Row>(sql`select picture_url, listing from commerce.design_presets where id = ${signal.id}::uuid`);
    try {
      const share = `/media/signal-share-${run}.jpg`;
      expect(await designs.saveThemeOwnPicture(admin, signal.id, "share", share)).toEqual({ ok: true });
      expect(await designs.saveThemeOwnPicture(admin, signal.id, "devices", "https://cdn.test/devices.webp")).toEqual({ ok: true });
      let card = (await store.themeStoreCards()).find((c) => c.slug === "signal")!;
      expect(card.listing.own).toEqual({ share, devices: "https://cdn.test/devices.webp" });
      expect(sharePicture(card)).toBe(share);
      expect(card.highlights?.find((h) => h.kind === "devices")?.url).toBe("https://cdn.test/devices.webp");

      // Refused: an address that is neither this site's nor https, a slot that is not one, someone who is not a platform admin.
      expect(await designs.saveThemeOwnPicture(admin, signal.id, "collage", "http://x.test/a.png")).toMatchObject({ ok: false });
      expect(await designs.saveThemeOwnPicture(admin, signal.id, "card" as never, share)).toMatchObject({ ok: false });
      expect(await designs.saveThemeOwnPicture({ ...admin, platformAdmin: false }, signal.id, "collage", share)).toMatchObject({ ok: false });

      // The listing form never sends them, and they stay; a new version of the launch theme keeps them and its main picture.
      expect(await designs.saveThemeListing(admin, signal.id, "signal", { kinds: ["digital"], styles: [], pictures: [], pack: null, presetPacks: {} })).toEqual({ ok: true });
      await db().execute(sql`update commerce.design_presets set picture_url = ${`/media/signal-main-${run}.webp`}, launch_version = launch_version - 1 where id = ${signal.id}::uuid`);
      const synced = await syncLaunchThemes(admin, deps);
      expect(synced.problems).toEqual([]);
      expect(synced.updated).toContain("Signal");
      const [after] = await db().execute<Row>(sql`select picture_url, listing -> 'own' as own from commerce.design_presets where id = ${signal.id}::uuid`);
      expect(after.picture_url).toBe(`/media/signal-main-${run}.webp`);
      expect(after.own).toEqual({ share, devices: "https://cdn.test/devices.webp" });

      // Taken away one by one: the made one shows again, and with none left the listing has no own pictures at all.
      expect(await designs.saveThemeOwnPicture(admin, signal.id, "share", null)).toEqual({ ok: true });
      card = (await store.themeStoreCards()).find((c) => c.slug === "signal")!;
      expect(card.listing.own).toEqual({ devices: "https://cdn.test/devices.webp" });
      expect(sharePicture(card)).toBe(`/media/signal-main-${run}.webp`);
      expect(await designs.saveThemeOwnPicture(admin, signal.id, "devices", null)).toEqual({ ok: true });
      const [cleared] = await db().execute<Row>(sql`select listing ? 'own' as has from commerce.design_presets where id = ${signal.id}::uuid`);
      expect(cleared.has).toBe(false);

      const audited = await db().execute<Row>(sql`
        select action, details ->> 'slot' as slot from commerce.audit_log
        where action like 'platform.theme_picture_%' and account_id = ${admin.id}::uuid and details ->> 'preset' = ${signal.id} order by id`);
      expect(audited.map((row) => [row.action, row.slot])).toEqual([
        ["platform.theme_picture_replaced", "share"],
        ["platform.theme_picture_replaced", "devices"],
        ["platform.theme_picture_restored", "share"],
        ["platform.theme_picture_restored", "devices"],
      ]);
    } finally {
      await db().execute(sql`update commerce.design_presets set picture_url = ${kept.picture_url as string | null}, listing = ${JSON.stringify(kept.listing)}::jsonb where id = ${signal.id}::uuid`);
    }
  });

  it("counts a theme's own picture as a use of Kaizena Flow's library file, so it is not deleted or moved unseen", async () => {
    const made = await designs.createDesign(admin, { details: { title: `Pictured ${run}`, summary: "", description: "", pictureUrl: null }, origin: { kind: "scratch" } }, deps);
    if (!made.ok) throw new Error(made.problems.join(" "));
    const url = `https://example.supabase.co/storage/v1/object/public/product-media/platform/own-${run}.webp`;
    const [file] = await db().execute<Row>(sql`
      insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, size_bytes, width, height)
      values (null, 'image', ${url}, 'product-media', ${`platform/own-${run}.webp`}, 'own.webp', 'image/webp', 1000, 1600, 1000) returning id`);
    expect(await designs.saveThemeOwnPicture(admin, made.id, "collage", url)).toEqual({ ok: true });
    const uses = (await mediaUses({ storeId: null, storeSlug: null }, [String(file.id)])).get(String(file.id))!;
    expect(uses).toContainEqual(expect.objectContaining({ label: `Theme: Pictured ${run}`, href: `/admin/platform/themes/${made.id}`, source: "theme_listing" }));
  });
});

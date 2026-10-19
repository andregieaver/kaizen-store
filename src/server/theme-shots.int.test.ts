import { sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { SHOT_TRIES, SHOT_TRIES_ALL, readShotPictures, type ShotKind } from "@/lib/theme-shots";

import type { Account } from "./auth";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const designs = await import("./design-presets");
const shots = await import("./theme-shots");
const { themeStoreCards } = await import("./theme-store");

/**
 * The photographs of a theme's looks (`docs/theme-showcase-phase-2.md` step 1): asked for by Publish, taken by the job through an injected
 * photographer and bucket, read by the theme store, set aside when a newer version is made, tried again, and pruned with their files. A look
 * is photographed only on a published demo store, never on the Standard store (D274).
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const ORIGIN = "http://shots.test";
const deps = {
  copyFile: async (bucket: string, _from: string, to: string) => `https://x.supabase.co/storage/v1/object/public/${bucket}/${to}`,
  installFonts: async () => ({ ok: true as const }),
};

let admin: Account;
let theme: string;
let standard: string;
/** The theme's own content (D275): a published content pack's store template (D257) and its store. */
let demo: { starter: string; store: string };
let photos: Record<ShotKind, { full: Buffer; screen: Buffer }>;

/** The bucket, kept in memory: what was uploaded (its bytes, by path) and what was removed. */
const bucket = { stored: new Map<string, Buffer>(), removed: [] as string[] };
const PUBLIC = "https://x.supabase.co/storage/v1/object/public/product-media/";
const looked: string[] = [];
let failFor: string | null = null;
/** How many of the next photographs come back one flat white, as a page that had not drawn did (D279). */
let blankTries = 0;
let blank: Buffer;
const shotDeps: import("./theme-shots").ShotDeps = {
  photograph: async (url, kind) => {
    looked.push(`${kind} ${url}`);
    if (failFor && url.includes(failFor)) throw new Error("The preview answered 500.");
    if (blankTries > 0) {
      blankTries--;
      return { full: blank, screen: blank, parts: { length: 900, header: null, rows: [], product: null, footer: null } };
    }
    return { ...photos[kind], parts: { length: 3000, header: { top: 0, height: 100 }, rows: [{ top: 100, height: 800 }], product: null, footer: null } };
  },
  upload: async (path, bytes) => {
    bucket.stored.set(path, Buffer.from(bytes));
    return { ok: true, url: `${PUBLIC}${path}` };
  },
  fetchFile: async (url) => {
    const bytes = bucket.stored.get(url.slice(PUBLIC.length));
    if (!bytes) throw new Error(`Not stored: ${url}`);
    return bytes;
  },
  remove: async (paths) => {
    bucket.removed.push(...paths);
    for (const path of paths) bucket.stored.delete(path);
    return true;
  },
};

const mine = async () =>
  db().execute<Row>(sql`
    select id, version, variation, starter_id, showcase_store_id, kind, status, tries, problem, pictures, claimed_until > now() as resting
      from commerce.theme_shots where preset_id = ${theme}::uuid order by version, kind
  `);

/** Runs the job until nothing of this theme is left to take (other tests' themes share the database and are left alone). */
const runJob = () => shots.runThemeShots(ORIGIN, Date.now() + shots.SHOT_MS + 120_000, shotDeps, { presetIds: [theme] });

async function publish(): Promise<void> {
  const result = await designs.publishDesign(admin, theme);
  if (!result.ok) throw new Error(result.problems.join(" "));
}

/** A made-up photograph of a page: a header band over the page's colour (one flat colour would be refused as blank, D279). */
const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#336699" } })
    .composite([{ input: { create: { width, height: Math.min(80, height), channels: 3, background: "#ffffff" } }, top: 0, left: 0 }])
    .png()
    .toBuffer();

beforeAll(async () => {
  photos = { computer: { full: await png(1440, 3000), screen: await png(1440, 900) }, phone: { full: await png(390, 2400), screen: await png(780, 1688) } };
  blank = await sharp({ create: { width: 1440, height: 900, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`shots-${run}@example.com`}, 'Admin', true) returning id, email`);
  admin = { id: String(row.id), email: String(row.email), name: "Admin", platformAdmin: true } as Account;
  standard = String((await db().execute<Row>(sql`select id from commerce.stores where is_template limit 1`))[0].id);
  // A published demo store of the food pack, as Kaizena Flow keeps them; one this test did not make is set aside, its store's address too.
  await db().execute(sql`
    update commerce.stores s set slug = left(s.slug, 20) || '-' || ${run}
    from commerce.store_starters ss where ss.store_id = s.id and ss.pack_key = 'food'
  `);
  await db().execute(sql`update commerce.store_starters set pack_key = pack_key || '-' || ${run} where pack_key = 'food'`);
  const [store] = await db().execute<Row>(sql`insert into commerce.stores (slug, name, starter) values (${`shots-demo-${run}`}, 'Shots demo', true) returning id`);
  const [starter] = await db().execute<Row>(sql`
    insert into commerce.store_starters (store_id, title, category, pack_key, pack_version, published)
    values (${String(store.id)}::uuid, 'Food', 'retail', 'food', 1, true) returning id
  `);
  demo = { starter: String(starter.id), store: String(store.id) };
  const made = await designs.createDesign(admin, { details: { title: `Shotline ${run}`, summary: "", description: "", pictureUrl: null }, origin: { kind: "scratch" } }, deps);
  if (!made.ok) throw new Error(made.problems.join(" "));
  theme = made.id;
  const listed = await designs.saveThemeListing(admin, theme, `shotline-${run}`, { kinds: [], styles: [], pictures: [] });
  if (!listed.ok) throw new Error(listed.problems.join(" "));
  // The demo store is the theme's own content (D275), as a launch theme's content pack is.
  await db().execute(sql`update commerce.store_starters set design_preset_id = ${theme}::uuid where id = ${demo.starter}::uuid`);
});

afterAll(async () => {
  await db().execute(sql`update commerce.store_starters set published = false, design_preset_id = null, pack_key = pack_key || '-x-' || ${run} where id = ${demo.starter}::uuid`);
  await closeDb();
});

describe("a theme's photographs", () => {
  it("are asked for when it is published: its own look on its demo store, at both widths, of the version just made", async () => {
    expect(await mine()).toEqual([]);
    await publish();
    const rows = await mine();
    expect(rows.map((r) => [r.version, r.variation, r.starter_id, r.showcase_store_id, r.kind, r.status])).toEqual([
      [1, null, demo.starter, demo.store, "computer", "waiting"],
      // Its highlights (`docs/theme-showcase-phase-2.md` step 2), composed once both photographs are made.
      [1, null, demo.starter, demo.store, "highlights", "waiting"],
      [1, null, demo.starter, demo.store, "phone", "waiting"],
    ]);
  });

  it("are taken by the job from the public preview, cut and stored, and only then marked made", async () => {
    await runJob();
    expect(looked).toContain(`computer ${ORIGIN}/admin/account/themes/${theme}/preview?starter=${demo.starter}&embed=1`);
    expect(looked).toContain(`phone ${ORIGIN}/admin/account/themes/${theme}/preview?starter=${demo.starter}&embed=1`);
    const rows = await mine();
    expect(rows.map((r) => r.status)).toEqual(["done", "done", "done"]);
    const computer = readShotPictures(rows[0].pictures);
    expect(Object.keys(computer).sort()).toEqual(["card", "full", "screen", "share"]);
    expect(computer.card).toMatchObject({ width: 800, height: 600 });
    expect(computer.share).toMatchObject({ width: 1200, height: 630 });
    expect(computer.card?.path).toBe(`platform/theme-shots/${theme}/${String(rows[0].id)}/computer-card.webp`);
    expect(bucket.stored.has(computer.share!.path)).toBe(true);
    expect(Object.keys(readShotPictures(rows[2].pictures)).sort()).toEqual(["full", "screen"]);
    // The highlights, drawn from the photographs read back from the bucket.
    const highlights = readShotPictures(rows[1].pictures);
    expect(Object.keys(highlights).sort()).toEqual(["closeup", "collage", "devices"]);
    expect(highlights.devices).toMatchObject({ width: 1600, height: 1000 });
    expect(highlights.devices?.path).toBe(`platform/theme-shots/${theme}/${String(rows[1].id)}/highlights-devices.webp`);
  });

  it("are what the theme store shows: the made card on its card and the share image on its page", async () => {
    const card = (await themeStoreCards()).find((c) => c.id === theme)!;
    expect(card.madeCard).toMatch(/computer-card\.webp$/);
    expect(card.madeShare).toMatch(/computer-share\.jpg$/);
    expect(card.looks[0].shots?.phone?.screen?.width).toBe(780);
    expect(card.looks[0].shots?.version).toBe(1);
    // Its highlights, in order, without words until a person writes them, then with them.
    expect(card.highlights?.map((h) => [h.kind, h.title])).toEqual([
      ["devices", null],
      ["collage", null],
      ["closeup", null],
    ]);
    const listed = await designs.saveThemeListing(admin, theme, `shotline-${run}`, {
      kinds: [],
      styles: [],
      pictures: [],
      highlights: { devices: { title: "On every screen", text: "A computer and two phones." } },
    });
    expect(listed.ok).toBe(true);
    const again = (await themeStoreCards()).find((c) => c.id === theme)!;
    expect(again.highlights?.[0]).toMatchObject({ kind: "devices", title: "On every screen", text: "A computer and two phones.", alt: `Shotline ${run}: on a computer and two phones` });
  });

  it("are asked for again for a new version, and the older set stays shown until the new one is made, then is set aside", async () => {
    const before = await designs.getDesign(theme);
    // A change of look makes a new version.
    await db().execute(sql`update commerce.stores set custom_css = '.x { color: red; }' where id = ${before!.workspaceStoreId}::uuid`);
    await publish();
    let rows = await mine();
    expect(rows.map((r) => [r.version, r.status])).toEqual([
      [1, "done"],
      [1, "done"],
      [1, "done"],
      [2, "waiting"],
      [2, "waiting"],
      [2, "waiting"],
    ]);
    expect((await shots.themeShotsFor([theme])).get(shots.lookOf(theme, null))?.version).toBe(1);
    await runJob();
    rows = await mine();
    expect(rows.map((r) => [r.version, r.status])).toEqual([
      [1, "superseded"],
      [1, "superseded"],
      [1, "superseded"],
      [2, "done"],
      [2, "done"],
      [2, "done"],
    ]);
    expect((await shots.themeShotsFor([theme])).get(shots.lookOf(theme, null))?.version).toBe(2);
  });

  it("set aside a unit no longer wanted when it is taken, rather than photograph it", async () => {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.theme_shots (preset_id, version, showcase_store_id, kind, status, tries, claimed_until)
      values (${theme}::uuid, 99, ${demo.store}::uuid, 'computer', 'running', 1, now() + interval '3 minutes') returning id
    `);
    const unit = { id: String(row.id), presetId: theme, version: 99, variation: null, starterId: demo.starter, showcaseStoreId: demo.store, kind: "computer" as const, status: "running" as const, tries: 1 };
    const count = looked.length;
    expect(await shots.takeThemeShot(unit, await shots.wantedNow(), ORIGIN, shotDeps)).toBe("superseded");
    expect(looked.length).toBe(count);
    await db().execute(sql`delete from commerce.theme_shots where id = ${unit.id}::uuid`);
  });

  it("are taken one at a time across runs: none is claimed while another is being photographed", async () => {
    const [busy] = await db().execute<Row>(sql`
      insert into commerce.theme_shots (preset_id, version, showcase_store_id, kind, status, tries, claimed_until)
      values (${theme}::uuid, 99, ${demo.store}::uuid, 'computer', 'running', 1, now() + interval '3 minutes') returning id
    `);
    const [waiting] = await db().execute<Row>(sql`
      insert into commerce.theme_shots (preset_id, version, showcase_store_id, kind, status)
      values (${theme}::uuid, 98, ${demo.store}::uuid, 'phone', 'waiting') returning id
    `);
    expect(await shots.claimThemeShot({ presetIds: [theme] })).toBeNull();
    // The run that held it stopped: its claim runs out and the queue moves on.
    await db().execute(sql`update commerce.theme_shots set claimed_until = now() - interval '1 second' where id = ${String(busy.id)}::uuid`);
    expect(await shots.claimThemeShot({ presetIds: [theme] })).not.toBeNull();
    expect(await shots.claimThemeShot({ presetIds: [theme] })).toBeNull();
    await db().execute(sql`delete from commerce.theme_shots where id in (${String(busy.id)}::uuid, ${String(waiting.id)}::uuid)`);
  });

  it("try again after a rest when a round of tries failed, are failed after the last round, and start over on Try again (D284)", async () => {
    const before = await designs.getDesign(theme);
    await db().execute(sql`update commerce.stores set custom_css = '.x { color: blue; }' where id = ${before!.workspaceStoreId}::uuid`);
    await publish();
    failFor = theme;
    await runJob();
    let rows = (await mine()).filter((r) => r.version === 3);
    // After a round of three tries each rests, waiting to be tried again by itself; the highlights wait for photographs that never came.
    expect(rows.map((r) => [r.kind, r.status, r.problem, r.resting])).toEqual([
      ["computer", "waiting", "The preview answered 500.", true],
      ["highlights", "waiting", null, null],
      ["phone", "waiting", "The preview answered 500.", true],
    ]);
    expect(rows.filter((r) => r.kind !== "highlights").map((r) => Number(r.tries))).toEqual([SHOT_TRIES, SHOT_TRIES]);
    // None is taken while it rests.
    expect(await shots.claimThemeShot({ presetIds: [theme] })).toBeNull();
    expect((await shots.themeShotStatus(theme)).find((unit) => unit.kind === "computer")?.retryAt).not.toBeNull();
    // Each rest over, another round; after the last the units fail and wait for a person.
    while ((await mine()).some((r) => r.version === 3 && r.kind !== "highlights" && r.status === "waiting")) {
      await db().execute(sql`update commerce.theme_shots set claimed_until = now() - interval '1 second' where preset_id = ${theme}::uuid and status = 'waiting'`);
      await runJob();
    }
    rows = (await mine()).filter((r) => r.version === 3);
    expect(rows.map((r) => [r.kind, r.status])).toEqual([
      ["computer", "failed"],
      ["highlights", "waiting"],
      ["phone", "failed"],
    ]);
    expect(rows.filter((r) => r.kind !== "highlights").map((r) => Number(r.tries))).toEqual([SHOT_TRIES_ALL, SHOT_TRIES_ALL]);
    // Version 2's pictures are still what the theme store shows.
    expect((await shots.themeShotsFor([theme])).get(shots.lookOf(theme, null))?.version).toBe(2);
    expect(await shots.retryThemeShots({ ...admin, platformAdmin: false }, theme)).toBe(0);
    expect(await shots.retryThemeShots(admin, theme)).toBe(2);
    failFor = null;
    // A photograph of a page that had not drawn (one flat colour) is not kept: a try, the look photographed again (D279).
    blankTries = 1;
    const stored = bucket.stored.size;
    const taken = await shots.claimThemeShot({ presetIds: [theme] });
    expect(await shots.takeThemeShot(taken!, await shots.queueThemeShots(), ORIGIN, shotDeps)).toBe("waiting");
    expect((await mine()).find((r) => r.id === taken!.id)).toMatchObject({ status: "waiting", tries: 1, problem: shots.BLANK_PAGE, pictures: null });
    expect(bucket.stored.size).toBe(stored);
    await runJob();
    rows = (await mine()).filter((r) => r.version === 3);
    expect(rows.map((r) => r.status)).toEqual(["done", "done", "done"]);
    expect(rows.find((r) => r.id === taken!.id)).toMatchObject({ tries: 2, problem: null });
    const audited = await db().execute<Row>(sql`select 1 from commerce.audit_log where action = 'platform.theme_shots_retried' and account_id = ${admin.id}::uuid`);
    expect(audited).toHaveLength(1);
  });

  it("come back as made when a set aside unit is wanted again before it is pruned", async () => {
    await designs.unpublishDesign(admin, theme);
    await shots.queueThemeShots();
    expect((await mine()).filter((r) => r.version === 3).map((r) => r.status)).toEqual(["superseded", "superseded", "superseded"]);
    await publish();
    expect((await mine()).filter((r) => r.version === 3).map((r) => r.status)).toEqual(["done", "done", "done"]);
  });

  it("are never wanted, nor shown, on the Standard store: a look whose demo store is not published waits for it (D274)", async () => {
    const shown = (await shots.themeShotsFor([theme])).get(shots.lookOf(theme, null));
    expect(shown?.version).toBe(3);
    // A set made on the Standard store before D274 is not what the theme store shows, however new.
    const [old] = await db().execute<Row>(sql`
      insert into commerce.theme_shots (preset_id, version, showcase_store_id, kind, status, tries, pictures, finished_at)
      values (${theme}::uuid, 3, ${standard}::uuid, 'computer', 'done', 1, ${JSON.stringify(readShotPictures((await mine()).find((r) => r.version === 3 && r.kind === "computer")!.pictures)).replaceAll("computer-", "standard-")}::jsonb, now() + interval '1 minute')
      returning id
    `);
    expect((await shots.themeShotsFor([theme])).get(shots.lookOf(theme, null))?.computer).toEqual(shown?.computer);
    // Nothing is wanted on it, so the queue sets it aside.
    expect((await shots.wantedNow()).some((w) => w.showcaseStoreId === standard)).toBe(false);
    await shots.queueThemeShots();
    expect((await db().execute<Row>(sql`select status from commerce.theme_shots where id = ${String(old.id)}::uuid`))[0].status).toBe("superseded");
    // The demo store unpublished: nothing of the theme's is wanted, and its card shows no photograph.
    await db().execute(sql`update commerce.store_starters set published = false where id = ${demo.starter}::uuid`);
    expect((await shots.wantedNow()).some((w) => w.presetId === theme)).toBe(false);
    const card = (await themeStoreCards()).find((c) => c.id === theme)!;
    expect(card.looks[0].showcase).toBeNull();
    expect(card.madeCard).toBeNull();
    expect(card.madeShare).toBeNull();
    await db().execute(sql`update commerce.store_starters set published = true where id = ${demo.starter}::uuid`);
    await shots.queueThemeShots();
    expect((await mine()).filter((r) => r.version === 3 && r.showcase_store_id === demo.store).map((r) => r.status)).toEqual(["done", "done", "done"]);
  });

  it("are pruned with their files a week after they were set aside", async () => {
    const old = (await mine()).filter((r) => r.status === "superseded");
    expect(old.length).toBeGreaterThan(0);
    const paths = old.flatMap((r) => Object.values(readShotPictures(r.pictures)).map((f) => f!.path));
    await db().execute(sql`update commerce.theme_shots set superseded_at = now() - interval '6 days' where preset_id = ${theme}::uuid and status = 'superseded'`);
    await shots.pruneThemeShots(shotDeps);
    expect((await mine()).filter((r) => r.status === "superseded")).toHaveLength(old.length);
    await db().execute(sql`update commerce.theme_shots set superseded_at = now() - interval '8 days' where preset_id = ${theme}::uuid and status = 'superseded'`);
    await shots.pruneThemeShots(shotDeps);
    expect((await mine()).filter((r) => r.status === "superseded")).toHaveLength(0);
    for (const path of paths) expect(bucket.removed).toContain(path);
  });
});

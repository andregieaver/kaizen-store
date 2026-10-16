import { sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { readShotPictures, type ShotKind } from "@/lib/theme-shots";

import type { Account } from "./auth";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const designs = await import("./design-presets");
const shots = await import("./theme-shots");
const { themeStoreCards } = await import("./theme-store");

/**
 * The photographs of a theme's looks (`docs/theme-showcase-phase-2.md` step 1): asked for by Publish, taken by the job through an injected
 * photographer and bucket, read by the theme store, set aside when a newer version is made, tried again, and pruned with their files.
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
let photos: Record<ShotKind, { full: Buffer; screen: Buffer }>;

/** The bucket, kept in memory: what was uploaded and what was removed. */
const bucket = { stored: new Map<string, number>(), removed: [] as string[] };
const looked: string[] = [];
let failFor: string | null = null;
const shotDeps: import("./theme-shots").ShotDeps = {
  photograph: async (url, kind) => {
    looked.push(`${kind} ${url}`);
    if (failFor && url.includes(failFor)) throw new Error("The preview answered 500.");
    return { ...photos[kind], parts: { length: 3000, header: { top: 0, height: 100 }, rows: [{ top: 100, height: 800 }], product: null, footer: null } };
  },
  upload: async (path, bytes) => {
    bucket.stored.set(path, bytes.length);
    return { ok: true, url: `https://x.supabase.co/storage/v1/object/public/product-media/${path}` };
  },
  remove: async (paths) => {
    bucket.removed.push(...paths);
    for (const path of paths) bucket.stored.delete(path);
    return true;
  },
};

const mine = async () =>
  db().execute<Row>(sql`select id, version, variation, starter_id, showcase_store_id, kind, status, tries, problem, pictures from commerce.theme_shots where preset_id = ${theme}::uuid order by version, kind`);

/** Runs the job until nothing is left to take (other tests' themes included: the photographer and bucket are this test's own). */
const runJob = () => shots.runThemeShots(ORIGIN, Date.now() + shots.SHOT_MS + 120_000, shotDeps);

async function publish(): Promise<void> {
  const result = await designs.publishDesign(admin, theme);
  if (!result.ok) throw new Error(result.problems.join(" "));
}

const png = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#336699" } }).png().toBuffer();

beforeAll(async () => {
  photos = { computer: { full: await png(1440, 3000), screen: await png(1440, 900) }, phone: { full: await png(390, 2400), screen: await png(780, 1688) } };
  const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`shots-${run}@example.com`}, 'Admin', true) returning id, email`);
  admin = { id: String(row.id), email: String(row.email), name: "Admin", platformAdmin: true } as Account;
  standard = String((await db().execute<Row>(sql`select id from commerce.stores where is_template limit 1`))[0].id);
  const made = await designs.createDesign(admin, { details: { title: `Shotline ${run}`, summary: "", description: "", pictureUrl: null }, origin: { kind: "scratch" } }, deps);
  if (!made.ok) throw new Error(made.problems.join(" "));
  theme = made.id;
  const listed = await designs.saveThemeListing(admin, theme, `shotline-${run}`, { kinds: [], styles: [], pictures: [], pack: null, presetPacks: {} });
  if (!listed.ok) throw new Error(listed.problems.join(" "));
});

afterAll(async () => {
  await closeDb();
});

describe("a theme's photographs", () => {
  it("are asked for when it is published: its own look on the Standard store, at both widths, of the version just made", async () => {
    expect(await mine()).toEqual([]);
    await publish();
    const rows = await mine();
    expect(rows.map((r) => [r.version, r.variation, r.starter_id, r.showcase_store_id, r.kind, r.status])).toEqual([
      [1, null, null, standard, "computer", "waiting"],
      [1, null, null, standard, "phone", "waiting"],
    ]);
  });

  it("are taken by the job from the public preview, cut and stored, and only then marked made", async () => {
    await runJob();
    expect(looked).toContain(`computer ${ORIGIN}/admin/account/design-profiles/${theme}/preview?embed=1`);
    expect(looked).toContain(`phone ${ORIGIN}/admin/account/design-profiles/${theme}/preview?embed=1`);
    const rows = await mine();
    expect(rows.map((r) => r.status)).toEqual(["done", "done"]);
    const computer = readShotPictures(rows[0].pictures);
    expect(Object.keys(computer).sort()).toEqual(["card", "full", "screen", "share"]);
    expect(computer.card).toMatchObject({ width: 800, height: 600 });
    expect(computer.share).toMatchObject({ width: 1200, height: 630 });
    expect(computer.card?.path).toBe(`platform/theme-shots/${theme}/${String(rows[0].id)}/computer-card.webp`);
    expect(bucket.stored.has(computer.share!.path)).toBe(true);
    expect(Object.keys(readShotPictures(rows[1].pictures)).sort()).toEqual(["full", "screen"]);
  });

  it("are what the theme store shows: the made card on its card and the share image on its page", async () => {
    const card = (await themeStoreCards()).find((c) => c.id === theme)!;
    expect(card.madeCard).toMatch(/computer-card\.webp$/);
    expect(card.madeShare).toMatch(/computer-share\.jpg$/);
    expect(card.looks[0].shots?.phone?.screen?.width).toBe(780);
    expect(card.looks[0].shots?.version).toBe(1);
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
      [2, "waiting"],
      [2, "waiting"],
    ]);
    expect((await shots.themeShotsFor([theme])).get(shots.lookOf(theme, null))?.version).toBe(1);
    await runJob();
    rows = await mine();
    expect(rows.map((r) => [r.version, r.status])).toEqual([
      [1, "superseded"],
      [1, "superseded"],
      [2, "done"],
      [2, "done"],
    ]);
    expect((await shots.themeShotsFor([theme])).get(shots.lookOf(theme, null))?.version).toBe(2);
  });

  it("set aside a unit no longer wanted when it is taken, rather than photograph it", async () => {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.theme_shots (preset_id, version, showcase_store_id, kind, status, tries, claimed_until)
      values (${theme}::uuid, 99, ${standard}::uuid, 'computer', 'running', 1, now() + interval '3 minutes') returning id
    `);
    const unit = { id: String(row.id), presetId: theme, version: 99, variation: null, starterId: null, showcaseStoreId: standard, kind: "computer" as const, status: "running" as const, tries: 1 };
    const count = looked.length;
    expect(await shots.takeThemeShot(unit, await shots.wantedNow(), ORIGIN, shotDeps)).toBe("superseded");
    expect(looked.length).toBe(count);
    await db().execute(sql`delete from commerce.theme_shots where id = ${unit.id}::uuid`);
  });

  it("wait for another try when they could not be made, are failed after the third, and start over on Try again", async () => {
    const before = await designs.getDesign(theme);
    await db().execute(sql`update commerce.stores set custom_css = '.x { color: blue; }' where id = ${before!.workspaceStoreId}::uuid`);
    await publish();
    failFor = theme;
    await runJob();
    let rows = (await mine()).filter((r) => r.version === 3);
    expect(rows.map((r) => [r.status, r.problem])).toEqual([
      ["failed", "The preview answered 500."],
      ["failed", "The preview answered 500."],
    ]);
    expect(rows.every((r) => Number(r.tries) === 3)).toBe(true);
    // Version 2's pictures are still what the theme store shows.
    expect((await shots.themeShotsFor([theme])).get(shots.lookOf(theme, null))?.version).toBe(2);
    expect(await shots.retryThemeShots({ ...admin, platformAdmin: false }, theme)).toBe(0);
    expect(await shots.retryThemeShots(admin, theme)).toBe(2);
    failFor = null;
    await runJob();
    rows = (await mine()).filter((r) => r.version === 3);
    expect(rows.map((r) => r.status)).toEqual(["done", "done"]);
    const audited = await db().execute<Row>(sql`select 1 from commerce.audit_log where action = 'platform.theme_shots_retried' and account_id = ${admin.id}::uuid`);
    expect(audited).toHaveLength(1);
  });

  it("come back as made when a set aside unit is wanted again before it is pruned", async () => {
    await designs.unpublishDesign(admin, theme);
    await shots.queueThemeShots();
    expect((await mine()).filter((r) => r.version === 3).map((r) => r.status)).toEqual(["superseded", "superseded"]);
    await publish();
    expect((await mine()).filter((r) => r.version === 3).map((r) => r.status)).toEqual(["done", "done"]);
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

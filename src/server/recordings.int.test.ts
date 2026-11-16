import { gunzipSync, gzipSync } from "node:zlib";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
// lockedOut() reads the unlock pass from next/headers' cookies, not from the headers passed in.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) }) }));
const EXP = "3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c";
vi.mock("./experiments", async (importOriginal) => ({ ...(await importOriginal<typeof import("./experiments")>()), runningExperiments: async () => [{ id: EXP }] }));

const { recordSegment, forgetRecordings, pruneRecordings, forgetRecordingMemos } = await import("./recordings");
const { mintUnlock } = await import("./private-mode");
const { forgetLimitMemos } = await import("./limits");
const { unlockCookieName } = await import("@/lib/unlock-pass");

/**
 * Recordings of visits on the server (D656, `docs/heatmaps-and-recordings.md` step 8): what keeps a segment, what stops a tab recording,
 * what is stored (the checked, stripped body, never the bytes as sent), and that forget and prune leave no file behind a row.
 */

const run = Date.now().toString(36);
const slug = `rec-${run}`;
let storeId: string;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const VISITOR = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-16T10:17:42Z");
const uuid = () => crypto.randomUUID();

/** Storage in memory, modelled on the review pictures' tests: a path written once, listed per recording folder. */
function memoryFiles(options: { fail?: boolean } = {}) {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async upload(path: string, bytes: Uint8Array) {
      if (options.fail) return "failed" as const;
      if (files.has(path)) return "exists" as const;
      files.set(path, bytes);
      return "ok" as const;
    },
    async download(path: string) {
      return files.get(path) ?? null;
    },
    async remove(paths: string[]) {
      for (const p of paths) files.delete(p);
      return true;
    },
    async list(store: string, id: string) {
      return [...files.keys()].filter((p) => p.startsWith(`${store}/${id}/`));
    },
  };
}

const consent = (recordings = true) => `consent_${storeId}=1.${VISITOR}.recordings.000${recordings ? 1 : 0}`;
const headers = (cookie = consent(), extra: Record<string, string> = {}, ua = UA) =>
  new Headers({ "user-agent": ua, host: "localhost:3000", origin: "http://localhost:3000", referer: `http://localhost:3000/s/${slug}/no`, cookie, ...extra });
const segment = (over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => ({
  v: 1,
  meta: { device: "mobile", w: 393, h: 852, pages: [`/s/${slug}/no`], clicks: 2, dead: 1, rage: 0, ab: [], ...meta },
  events: [
    { type: 4, timestamp: 0, data: { href: `http://localhost:3000/s/${slug}/no?email=someone@example.com#top`, width: 393, height: 852 } },
    { type: 2, timestamp: 12, data: { node: {} } },
    { type: 3, timestamp: 4200, data: { source: 2 } },
  ],
  ...over,
});
const send = (id: string, seq: number, body: unknown, files: ReturnType<typeof memoryFiles> | null, h = headers(), z: "0" | "1" = "1") =>
  recordSegment(
    { headers: h, query: { store: slug, id, seq: String(seq), z }, bytes: z === "1" ? new Uint8Array(gzipSync(JSON.stringify(body))) : new TextEncoder().encode(JSON.stringify(body)), now: NOW },
    { files },
  );
const recording = async (id: string) => (await db().execute<Row>(sql`select * from commerce.recordings where id = ${id}::uuid`))[0];
const setStore = (column: "recordings" | "private_mode", on: boolean) =>
  column === "recordings"
    ? db().execute(sql`update commerce.stores set recordings = ${on} where id = ${storeId}::uuid`)
    : db().execute(sql`update commerce.stores set private_mode = ${on} where id = ${storeId}::uuid`);
const setOpen = (on: boolean) => db().execute(sql`update commerce.platform_settings set recordings_open = ${on}`);

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Recordings test', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set time_zone = 'Europe/Oslo', private_mode = false, recordings = true where id = ${storeId}::uuid`);
});

beforeEach(async () => {
  await db().execute(sql`delete from commerce.recordings where store_id = ${storeId}::uuid`);
  await db().execute(sql`delete from commerce.chat_usage where store_id = ${storeId}::uuid`);
  await db().execute(sql`delete from commerce.limit_overrides where store_id = ${storeId}::uuid`);
  await setStore("recordings", true);
  await setStore("private_mode", false);
  await setOpen(true);
  forgetRecordingMemos();
  forgetLimitMemos();
  jar.clear();
});

afterAll(async () => {
  await setOpen(false);
  await closeDb();
});

describe("a recording's segments (D656)", () => {
  it("creates the row on seq 0 with coarse times and sizes, and adds seq 1 to it", async () => {
    const files = memoryFiles();
    const id = uuid();
    expect(await send(id, 0, segment(), files)).toBe(204);
    const row = await recording(id);
    expect(row).toMatchObject({ store_id: storeId, device: "mobile", width: 390, height: 850, entry_page: "/no", mask: "balanced", segments: 1, clicks: 2, dead_clicks: 1 });
    expect(new Date(String(row.started_at)).toISOString()).toBe("2026-11-16T10:10:00.000Z");
    expect(row.seqs).toEqual([0]);
    expect(await send(id, 1, segment({}, { pages: [`/s/${slug}/no/p/demo-mug`], clicks: 1, dead: 0 }), files)).toBe(204);
    const after = await recording(id);
    expect(after).toMatchObject({ segments: 2, clicks: 3, pages: ["/no", "/no/p/demo-mug"] });
    expect(after.seqs).toEqual([0, 1]);
    expect(after.duration_ms).toBe(4200);
    expect([...files.files.keys()].sort()).toEqual([`${storeId}/${id}/000.gz`, `${storeId}/${id}/001.gz`]);
  });

  it("stores the checked body with a Meta event's address stripped of its query, never the bytes as sent", async () => {
    const files = memoryFiles();
    const id = uuid();
    expect(await send(id, 0, segment(), files, headers(), "0")).toBe(204);
    const stored = JSON.parse(gunzipSync(files.files.get(`${storeId}/${id}/000.gz`)!).toString("utf8"));
    expect(stored.events[0].data.href).toBe(`http://localhost:3000/s/${slug}/no`);
    expect(JSON.stringify(stored)).not.toContain("someone@example.com");
  });

  it("tells the tab to stop: without consent, under GPC, for a robot, switched off, while held, locked out, on a refused page, over the month and over the day", async () => {
    const files = memoryFiles();
    const stopped = async (h: Headers, body = segment()) => expect(await send(uuid(), 0, body, files, h)).toBe(410);
    await stopped(headers(consent(false)));
    await stopped(headers(`consent_${storeId}=1.${VISITOR}.statistics.010`));
    await stopped(headers(consent(), { "sec-gpc": "1" }));
    await stopped(headers(consent(), {}, "Googlebot/2.1 (+http://www.google.com/bot.html)"));
    await stopped(headers(), segment({}, { pages: [`/s/${slug}/no/cart`] }));
    await stopped(headers(), segment({}, { pages: [`/s/${slug}/no/search`] }));
    await setStore("private_mode", true);
    await stopped(headers());
    await setStore("private_mode", false);
    await setStore("recordings", false);
    await stopped(headers());
    await setStore("recordings", true);
    await setOpen(false);
    await stopped(headers());
    await setOpen(true);
    await db().execute(sql`insert into commerce.limit_overrides (store_id, key, value, reason) values (${storeId}::uuid, 'recordings_month', 0, 'Test')`);
    forgetLimitMemos();
    await stopped(headers());
    await db().execute(sql`delete from commerce.limit_overrides where store_id = ${storeId}::uuid`);
    forgetRecordingMemos();
    await db().execute(sql`insert into commerce.chat_usage (store_id, bucket, "window", count) values (${storeId}::uuid, 'recordings', date_trunc('day', now()), 2000)`);
    await stopped(headers());
    expect(files.files.size).toBe(0);
    expect(await db().execute<Row>(sql`select id from commerce.recordings where store_id = ${storeId}::uuid`)).toHaveLength(0);
  });

  it("keeps Kaizena Flow's own store recording while held, and a private store's visitor who entered its password", async () => {
    const files = memoryFiles();
    await setOpen(false);
    const [house] = await db().execute<Row>(sql`select count(*)::int as n from commerce.stores where house`);
    if (Number(house.n) === 0) {
      await db().execute(sql`update commerce.stores set house = true where id = ${storeId}::uuid`);
      try {
        expect(await send(uuid(), 0, segment(), files)).toBe(204);
      } finally {
        await db().execute(sql`update commerce.stores set house = false where id = ${storeId}::uuid`);
      }
    }
    await setOpen(true);
    const before = process.env.SETTINGS_ENCRYPTION_KEY;
    process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    try {
      await setStore("private_mode", true);
      const [state] = await db().execute<Row>(sql`select private_version from commerce.stores where id = ${storeId}::uuid`);
      jar.set(unlockCookieName(storeId), mintUnlock("password", { id: storeId, slug }, Number(state.private_version))!);
      expect(await send(uuid(), 0, segment(), files)).toBe(204);
    } finally {
      process.env.SETTINGS_ENCRYPTION_KEY = before;
    }
  });

  it("answers 503 and keeps nothing without storage, then creates the row when seq 0 comes again", async () => {
    const id = uuid();
    expect(await send(id, 0, segment(), null)).toBe(503);
    expect(await recording(id)).toBeUndefined();
    expect(await send(id, 0, segment(), memoryFiles({ fail: true }))).toBe(503);
    const files = memoryFiles();
    expect(await send(id, 0, segment(), files)).toBe(204);
    expect((await recording(id)).segments).toBe(1);
  });

  it("refuses a zip bomb and invalid bodies", async () => {
    const files = memoryFiles();
    const bomb = gzipSync("x".repeat(20 * 1024 * 1024));
    expect(await recordSegment({ headers: headers(), query: { store: slug, id: uuid(), seq: "0", z: "1" }, bytes: new Uint8Array(bomb), now: NOW }, { files })).toBe(400);
    expect(await send(uuid(), 0, { v: 2 }, files)).toBe(400);
    expect(await send(uuid(), 0, segment({ events: [] }), files)).toBe(400);
    expect(await recordSegment({ headers: headers(), query: { store: slug, id: "not-an-id", seq: "0", z: "1" }, bytes: new Uint8Array(), now: NOW }, { files })).toBe(400);
  });

  it("stops a tab whose id belongs to another store, and removes the file it wrote", async () => {
    const files = memoryFiles();
    const id = uuid();
    const [other] = await db().execute<Row>(sql`select id from commerce.stores where id <> ${storeId}::uuid limit 1`);
    await db().execute(sql`
      insert into commerce.recordings (id, store_id, day, started_at, last_at, device, entry_page, mask)
      values (${id}::uuid, ${String(other.id)}::uuid, '2026-11-16', now(), now(), 'mobile', '/no', 'balanced')`);
    expect(await send(id, 0, segment(), files)).toBe(410);
    expect(await send(id, 1, segment(), files)).toBe(410);
    expect(files.files.size).toBe(0);
    await db().execute(sql`delete from commerce.recordings where id = ${id}::uuid`);
  });

  it("counts a segment sent twice once, keeps a gap, and names exactly the files that exist", async () => {
    const files = memoryFiles();
    const id = uuid();
    for (const seq of [0, 1, 1, 3]) expect(await send(id, seq, segment(), files)).toBe(204);
    const row = await recording(id);
    expect(row.seqs).toEqual([0, 1, 3]);
    expect(row.segments).toBe(3);
    const { pathsOf } = await import("@/lib/recording");
    expect(pathsOf({ storeId, id, sealed: false, seqs: row.seqs as number[] })).toEqual([...files.files.keys()].sort());
  });

  it("removes the file when the row cannot take it (a sealed recording)", async () => {
    const files = memoryFiles();
    const id = uuid();
    await send(id, 0, segment(), files);
    await db().execute(sql`update commerce.recordings set sealed = true where id = ${id}::uuid`);
    expect(await send(id, 1, segment(), files)).toBe(410);
    expect([...files.files.keys()]).toEqual([`${storeId}/${id}/000.gz`]);
  });

  it("keeps a verified A/B version, once", async () => {
    const files = memoryFiles();
    const id = uuid();
    const cookie = `${consent()}; kaizen_ab_${storeId}=${encodeURIComponent(`1.${VISITOR}.${EXP}=b`)}`;
    await send(id, 0, segment({}, { ab: [[EXP, "b"], [EXP, "c"]] }), files, headers(cookie));
    await send(id, 1, segment({}, { ab: [[EXP, "b"]] }), files, headers(cookie));
    expect((await recording(id)).tags).toEqual([`${EXP}:b`]);
  });
});

describe("forget and prune (D656)", () => {
  it("forget deletes the rows a browser names and removes exactly their files, a stray one included", async () => {
    const files = memoryFiles();
    const [a, b, kept] = [uuid(), uuid(), uuid()];
    for (const id of [a, b, kept]) await send(id, 0, segment(), files);
    files.files.set(`${storeId}/${a}/007.gz`, new Uint8Array([1]));
    expect(await forgetRecordings({ store: slug, ids: [a, b, "not-an-id"] }, { files })).toBe(2);
    expect([...files.files.keys()]).toEqual([`${storeId}/${kept}/000.gz`]);
    expect(await recording(kept)).toBeDefined();
    // Without storage nothing changes, so no file outlives its row.
    expect(await forgetRecordings({ store: slug, ids: [kept] }, { files: null })).toBe(0);
    expect(await recording(kept)).toBeDefined();
  });

  it("prune deletes recordings past 30 days with their files, a closed store's too, and stops at its deadline", async () => {
    const files = memoryFiles();
    const [old, fresh] = [uuid(), uuid()];
    await send(old, 0, segment(), files);
    await send(fresh, 0, segment(), files);
    await db().execute(sql`update commerce.recordings set started_at = now() - interval '31 days' where id = ${old}::uuid`);
    expect(await pruneRecordings(new Date(), Date.now() - 1, { files })).toBe(0);
    await db().execute(sql`update commerce.stores set status = 'closed' where id = ${storeId}::uuid`);
    try {
      expect(await pruneRecordings(new Date(), Date.now() + 10_000, { files })).toBeGreaterThanOrEqual(1);
    } finally {
      await db().execute(sql`update commerce.stores set status = 'active' where id = ${storeId}::uuid`);
    }
    expect(await recording(old)).toBeUndefined();
    expect(await recording(fresh)).toBeDefined();
    expect([...files.files.keys()]).toEqual([`${storeId}/${fresh}/000.gz`]);
  });
});

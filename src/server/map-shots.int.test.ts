import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { MapLayout } from "@/lib/heat-read";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
const EXP = "3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c";
vi.mock("./experiments", async (importOriginal) => ({ ...(await importOriginal<typeof import("./experiments")>()), runningExperiments: async () => [{ id: EXP }] }));

const { mapShotOf, pruneMapShots, requestMapShot, runMapShots, PRIVATE_STORE_PROBLEM } = await import("./map-shots");

/** Heatmaps' pictures (D656, `docs/heatmaps-and-recordings.md` 9): asked for, claimed one at a time, taken, stored, failed and pruned. */

const run = Date.now().toString(36);
const slug = `maps-${run}`;
let storeId: string;
const LAYOUT: MapLayout = { v: 1, w: 390, h: 2400, fold: 844, anchors: { "@main": [0, 80, 390, 2000] } };

type Taken = { url: string; width: number; cookies: string[] };
const fakes = () => {
  const taken: Taken[] = [];
  const stored: string[] = [];
  const removed: string[] = [];
  return {
    taken,
    stored,
    removed,
    deps: {
      photograph: async (url: string, viewport: { width: number }, cookies: readonly { name: string }[]) => {
        taken.push({ url, width: viewport.width, cookies: cookies.map((c) => c.name) });
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { picture: Buffer.from([0xff, 0xd8, 0xff]), layout: LAYOUT };
      },
      files: {
        upload: async (path: string) => (stored.push(path), true),
        signedUrl: async (path: string) => `https://files.example/${path}?signed`,
        remove: async (paths: string[]) => (removed.push(...paths), true),
      },
    },
  };
};
const later = () => Date.now() + 10 * 60_000;
const rows = () => db().execute<Row>(sql`select page, device, tag, status, problem, width, height, layout from commerce.page_map_shots where store_id = ${storeId}::uuid order by page, tag`);

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Maps test', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set private_mode = false where id = ${storeId}::uuid`);
});

beforeEach(async () => {
  await db().execute(sql`delete from commerce.page_map_shots`);
  await db().execute(sql`update commerce.stores set private_mode = false where id = ${storeId}::uuid`);
});

afterAll(async () => {
  await closeDb();
});

describe("heatmaps' pictures (D656)", () => {
  it("takes a waiting picture as a refusing robot and keeps where its parts are", async () => {
    const f = fakes();
    expect((await requestMapShot(storeId, "/no/p/demo-mug", "mobile", "")).status).toBe("waiting");
    expect(await runMapShots(later(), f.deps)).toEqual({ taken: 1 });
    const [row] = await rows();
    expect(row).toMatchObject({ status: "done", width: 390, height: 2400, problem: null });
    expect(row.layout).toEqual(LAYOUT);
    expect(f.taken[0].url).toMatch(new RegExp(`/s/${slug}(/no)?/p/demo-mug$`));
    expect(f.taken[0].cookies).toEqual([`consent_${storeId}`]);
    expect(f.stored).toHaveLength(1);
    expect(f.stored[0]).toMatch(new RegExp(`^${storeId}/[0-9a-f-]{36}\\.jpg$`));
  });

  it("opens a version of a running test with its cookies, and fails one whose test has ended", async () => {
    const f = fakes();
    await requestMapShot(storeId, "/no", "desktop", `${EXP}:b`);
    await requestMapShot(storeId, "/no", "desktop", "11111111-1111-4111-8111-111111111111:b");
    await runMapShots(later(), f.deps);
    expect(f.taken).toHaveLength(1);
    expect(f.taken[0].cookies).toEqual([`consent_${storeId}`, "kaizen_ab", `kaizen_ab_${storeId}`]);
    const ended = (await rows()).find((r) => String(r.tag).startsWith("1111"));
    expect(ended).toMatchObject({ status: "failed", problem: "The test has ended, so this version is no longer shown." });
  });

  it("fails with a short problem when the browser does, and on a private store", async () => {
    const f = fakes();
    await requestMapShot(storeId, "/no", "mobile", "");
    await runMapShots(later(), { ...f.deps, photograph: async () => Promise.reject(new Error("The page answered 500, so it could not be photographed.")) });
    expect((await rows())[0]).toMatchObject({ status: "failed", problem: "The page answered 500, so it could not be photographed." });
    await db().execute(sql`delete from commerce.page_map_shots`);
    await db().execute(sql`update commerce.stores set private_mode = true where id = ${storeId}::uuid`);
    await requestMapShot(storeId, "/no", "mobile", "");
    await runMapShots(later(), f.deps);
    expect((await rows())[0]).toMatchObject({ status: "failed", problem: PRIVATE_STORE_PROBLEM });
    expect(f.taken).toHaveLength(0);
  });

  it("never lets two runs take the same picture", async () => {
    const a = fakes();
    const b = fakes();
    for (const page of ["/no", "/no/p/one", "/no/p/two"]) await requestMapShot(storeId, page, "mobile", "");
    const [ra, rb] = await Promise.all([runMapShots(later(), a.deps), runMapShots(later(), b.deps)]);
    expect(ra.taken + rb.taken).toBe(3);
    const urls = [...a.taken, ...b.taken].map((t) => t.url);
    expect(new Set(urls).size).toBe(3);
  });

  it("asks again only for a picture over 14 days old, one that failed over an hour ago, or when the owner asks", async () => {
    const f = fakes();
    await requestMapShot(storeId, "/no", "mobile", "");
    await runMapShots(later(), f.deps);
    expect((await requestMapShot(storeId, "/no", "mobile", "")).status).toBe("done");
    await db().execute(sql`update commerce.page_map_shots set shot_at = now() - interval '15 days' where store_id = ${storeId}::uuid`);
    expect((await requestMapShot(storeId, "/no", "mobile", "")).status).toBe("waiting");
    await runMapShots(later(), f.deps);
    expect((await requestMapShot(storeId, "/no", "mobile", "", true)).status).toBe("waiting");
    await db().execute(sql`update commerce.page_map_shots set status = 'failed', requested_at = now() - interval '10 minutes' where store_id = ${storeId}::uuid`);
    expect((await requestMapShot(storeId, "/no", "mobile", "")).status).toBe("failed");
    await db().execute(sql`update commerce.page_map_shots set requested_at = now() - interval '2 hours' where store_id = ${storeId}::uuid`);
    expect((await requestMapShot(storeId, "/no", "mobile", "")).status).toBe("waiting");
  });

  it("starts no picture that cannot end before the run's end, and prunes what nobody asked for in 90 days with its file", async () => {
    const f = fakes();
    await requestMapShot(storeId, "/no", "mobile", "");
    expect(await runMapShots(Date.now() + 30_000, f.deps)).toEqual({ taken: 0 });
    expect((await mapShotOf(storeId, "/no", "mobile", ""))?.status).toBe("waiting");
    await db().execute(sql`update commerce.page_map_shots set requested_at = now() - interval '91 days' where store_id = ${storeId}::uuid`);
    expect(await pruneMapShots(f.deps.files)).toBe(1);
    expect(f.removed).toHaveLength(1);
    expect(await rows()).toHaveLength(0);
  });
});

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  updateTag: () => {
    throw new Error("updateTag can only be called from within a Server Action");
  },
  revalidateTag: () => {},
}));

const { closeDb, db } = await import("@/db/client");
const { tracked } = await import("./cron-runs");
const { refreshTag } = await import("./refresh");
const { cacheEventsWeek, countCacheEvent, flushCacheEvents, tagParts } = await import("./cache-events");

const JOB = "test.cache-events";
const clean = async () => {
  await db().execute(sql`delete from commerce.cache_events_daily where subject in ('cache-events-test', 'cache-events-ten') or family = 'platform-chrome-test' or subject = 'cache-events-build'`);
  await db().execute(sql`delete from commerce.cron_jobs where job = ${JOB}`);
};

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  await clean();
});
afterAll(async () => {
  await clean();
  await closeDb();
});

describe("cache events (bloat review step 1.25)", () => {
  it("splits a tag into its family and subject", () => {
    expect(tagParts("store:demo")).toEqual({ family: "store", subject: "demo" });
    expect(tagParts("catalog:7b1e0000-0000-4000-8000-000000000000")).toEqual({ family: "catalog", subject: "7b1e0000-0000-4000-8000-000000000000" });
    expect(tagParts("catalog")).toEqual({ family: "catalog", subject: "" });
    expect(tagParts("terms:platform:article")).toEqual({ family: "terms", subject: "platform" });
  });

  it("a job that refreshes one store's tag 11 times in a day is flagged", async () => {
    await tracked(JOB, 300, async () => {
      for (let i = 0; i < 11; i++) refreshTag("store:cache-events-test");
    });
    const { flagged } = await cacheEventsWeek();
    const mine = flagged.filter((r) => r.subject === "cache-events-test");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ family: "store", source: "job", count: 11 });
  });

  it("10 refreshes by a job give no flag", async () => {
    await tracked(JOB, 300, async () => {
      for (let i = 0; i < 10; i++) refreshTag("store:cache-events-ten");
    });
    const { rows, flagged } = await cacheEventsWeek();
    expect(rows.find((r) => r.subject === "cache-events-ten")).toMatchObject({ source: "job", count: 10 });
    expect(flagged.find((r) => r.subject === "cache-events-ten")).toBeUndefined();
  });

  it("counts a refresh outside a job as a route's, and never flags a tag with no subject", async () => {
    refreshTag("store:cache-events-ten");
    refreshTag("platform-chrome-test");
    await flushCacheEvents();
    const { rows, flagged } = await cacheEventsWeek();
    expect(rows.find((r) => r.subject === "cache-events-ten" && r.source === "route")).toMatchObject({ count: 1 });
    expect(rows.find((r) => r.family === "platform-chrome-test")).toMatchObject({ subject: "", source: "route", count: 1 });
    expect(flagged.find((r) => r.family === "platform-chrome-test")).toBeUndefined();
  });

  it("counts nothing while Next builds: the build's prerenders are no visitor's draws", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    try {
      countCacheEvent("draw", "store", "cache-events-build", "render");
    } finally {
      vi.unstubAllEnvs();
    }
    await flushCacheEvents();
    const { rows } = await cacheEventsWeek();
    expect(rows.find((r) => r.subject === "cache-events-build")).toBeUndefined();
  });
});

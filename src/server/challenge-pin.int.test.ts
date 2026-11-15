import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { challengeFor, saveChallenge } = await import("./autopilot-settings");
const { currentVersions, pinChallenge, watchChallengeVersions } = await import("./challenge-pin");
const { challengeSmokePages } = await import("./challenge-smoke");
const { makeAccount, makeStore } = await import("./trust-fixtures");

/**
 * Challenge stores protected from deploys (`docs/100-day-challenge.md` F5) on a real store: what its AI runs on is pinned when the challenge is
 * set, a change seen after that is logged on the challenge once, changing the dates keeps the pin and the log, and its pages join the smoke.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let admin: Awaited<ReturnType<typeof makeAccount>>;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  store = await makeStore("challenge-pin");
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${store.id}::uuid`);
  admin = await makeAccount("pin-admin", { platformAdmin: true });
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.autopilot_settings where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("pinning a challenge store's AI (F5)", () => {
  it("pins what it runs on when the challenge is set, once", async () => {
    const set = await saveChallenge({ account: admin }, store.id, { startsOn: day(-1), dayOne: day(0), endsOn: day(99) });
    const pinned = await pinChallenge(store.id, set);
    const now = await currentVersions(store.id);
    expect(pinned.pinned).toMatchObject({ prompts: now.prompts, tools: now.tools, model: now.model });
    expect((await pinChallenge(store.id, pinned)).pinned?.at).toBe(pinned.pinned?.at);
  });

  it("logs a change the watch sees, once, and keeps the pin and the log when the dates change", async () => {
    const c = await challengeFor(store.id);
    // As if the store last ran on other tools and another model: the next watch sees the change.
    await db().execute(sql`
      update commerce.autopilot_settings set challenge = ${JSON.stringify({ ...c, seen: { ...c!.seen, tools: "old-tools", model: "openai/old-model" } })}::jsonb
      where store_id = ${store.id}::uuid
    `);
    expect(await watchChallengeVersions()).toBeGreaterThanOrEqual(1);
    expect(await watchChallengeVersions()).toBe(0);
    const logged = await challengeFor(store.id);
    expect(logged?.versionLog.map((e) => e.what)).toEqual(expect.arrayContaining([expect.stringContaining("The tools changed from old-tools to")]));
    await saveChallenge({ account: admin }, store.id, { startsOn: day(-1), dayOne: day(0), endsOn: day(95) });
    expect(await challengeFor(store.id)).toMatchObject({ endsOn: day(95), pinned: logged?.pinned, versionLog: logged?.versionLog });
  });

  it("puts the store's front page and cart in the deploy's smoke while challenge mode is on", async () => {
    const pages = await challengeSmokePages();
    expect(pages.filter((p) => p.includes(store.slug))).toHaveLength(2);
    expect(pages.find((p) => p.includes(store.slug) && p.endsWith("/cart"))).toMatch(/^https?:\/\//);
  });
});

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

/** The store's AI, scripted: the adviser's answer or the post creator's, by what it is asked. */
const ADVICE = {
  verdicts: ["The shop is new, so there is little to go on yet.", "Instagram is not connected.", "Nothing has been posted from here yet."],
  recommendations: [{ title: "Tell people the shop is open", why: "A first post brings the first visits.", kind: "write", productId: null, topic: "The shop is open", channels: ["instagram"] }],
  calendar: [],
};
const POSTS = { posts: [{ channel: "instagram", caption: "We are open.", hashtags: ["shop"] }] };
vi.mock("./ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("./ai")>();
  return {
    ...real,
    aiFor: async () => ({ provider: "openai", textModel: "fake", usage: { storeId: null, feature: "social_adviser", accountId: null } }),
    chatWithTools: async (_c: unknown, messages: { content: string }[]) => ({
      content: JSON.stringify(String(messages[0].content).includes("social media adviser") ? ADVICE : POSTS),
      toolCalls: [],
    }),
  };
});

const { closeDb, db } = await import("@/db/client");
const { makeStore } = await import("./trust-fixtures");
const { getStore } = await import("./stores");
const ownerTools = await import("./owner-tools");

/**
 * The AI manager's social media tools (D870 S1.4b): the adviser's newest answer read with its figures, a new one asked for, and posts written
 * with the creator, each through the screen's own function. Nothing is posted.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
const ctx = async () => ({ account: store.account, store: (await getStore(store.slug))!, holder: { role: "owner" as const }, invalidate: () => {} });
const run = async (name: string, args: unknown) => ownerTools.runOwnerTool(await ctx(), name, args);

beforeAll(async () => {
  store = await makeStore("social-tools");
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.social_posts where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.social_advice where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("the AI manager's social media tools", () => {
  it("says no advice is kept yet, then asks the adviser and reads its answer back with the figures it read", async () => {
    expect(await run("social_report", {})).toMatchObject({ advice: null, link: `/admin/${store.slug}/social` });
    const asked = (await run("social_plan", {})) as { verdicts: string[]; recommendations: { does: string; topic: string }[] };
    expect(asked.verdicts).toHaveLength(3);
    expect(asked.recommendations).toEqual([expect.objectContaining({ does: "write", topic: "The shop is open" })]);
    const read = (await run("social_report", {})) as { verdicts: string[]; figures: { instagram: string; sales_last_28_days: { orders: number } } };
    expect(read.verdicts).toEqual(asked.verdicts);
    expect(read.figures.instagram).toBe("not connected");
    expect(read.figures.sales_last_28_days.orders).toBe(0);
  });

  it("writes posts with the creator and keeps them on the page, posting nothing", async () => {
    const done = (await run("write_social_posts", { channels: ["instagram"], topic: "The shop is open" })) as { done: string };
    expect(done.done).toContain("Nothing is posted");
    const [kept] = await db().execute<{ n: number }>(sql`select count(*)::int as n from commerce.social_posts where store_id = ${store.id}::uuid and channel = 'instagram'`);
    expect(Number(kept.n)).toBe(1);
  });
});

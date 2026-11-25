import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

/** The store's model that sees pictures, scripted: what it is asked and the picture it gets are kept, its answer is the next in line. */
const asked: { system: string; hasPicture: boolean }[] = [];
const answers: string[] = [];
vi.mock("./ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("./ai")>();
  return {
    ...real,
    completeText: async (_c: unknown, messages: { content: unknown }[]) => {
      const user = messages[1].content as { type: string }[];
      asked.push({ system: String(messages[0].content), hasPicture: user.some((p) => p.type === "image_url") });
      return { text: answers.shift() ?? "", region: null };
    },
  };
});

const { closeDb, db } = await import("@/db/client");
const { makeStore } = await import("./trust-fixtures");
const { passMembership } = await import("./auth");
const { checkSocialPosts } = await import("./social-vision");
const { calendarOf, editSocialPost } = await import("./social-calendar");

/**
 * The vision check (D870 S2.3): each post's picture sent to the store's model that sees pictures, its verdict kept on the post, a failed post
 * left out of Approve the week, a post with no answer left unchecked, and the verdict cleared when the post's words change.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let good: string;
let bad: string;
let silent: string;
const connection = { provider: "openai", textModel: "fake", visionModel: "fake-vision", usage: { storeId: null, feature: "social_posts", accountId: null } } as never;
const picture = async () => ({ bytes: new Uint8Array([137, 80, 78, 71]), type: "image/png" });

const post = async (ref: string, channel: string) => {
  const [row] = await db().execute<{ id: string }>(sql`
    insert into commerce.social_posts (store_id, channel, ref, topic, locale, caption, link, planned_for)
    values (${store.id}::uuid, ${channel}, ${ref}, 'The workshop at work', 'en-GB', 'A morning in the workshop.', 'https://example.com', '2026-11-26') returning id`);
  return String(row.id);
};

beforeAll(async () => {
  store = await makeStore("social-vision");
  good = await post("visiongoodaa", "instagram");
  bad = await post("visionbadaaa", "facebook");
  silent = await post("visionsilent", "pinterest");
}, 60_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.social_posts where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("the vision check of a post's picture", () => {
  it("keeps each post's verdict, leaves a post without an answer unchecked, and keeps a failed post out of Approve the week", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    answers.push(
      '{"readable": true, "shows_subject": true, "whole": true, "on_brand": true, "note": ""}',
      '{"readable": false, "shows_subject": true, "whole": true, "on_brand": true, "note": "The headline is pale on a pale background."}',
      "I cannot tell.",
    );
    const result = await checkSocialPosts(member, [good, bad, silent], "https://example.com", { connection, picture });
    expect(result.ok).toBe(true);
    expect(asked).toHaveLength(3);
    expect(asked.every((a) => a.hasPicture && a.system.includes("picture checker"))).toBe(true);
    const rows = await db().execute<{ id: string; checked_at: string | null; check_problems: string[]; check_note: string }>(
      sql`select id, checked_at, check_problems, check_note from commerce.social_posts where store_id = ${store.id}::uuid`,
    );
    const of = (id: string) => rows.find((r) => r.id === id)!;
    expect(of(good)).toMatchObject({ check_problems: [], check_note: "" });
    expect(of(good).checked_at).not.toBeNull();
    expect(of(bad)).toMatchObject({ check_problems: ["unreadable"], check_note: "The headline is pale on a pale background." });
    expect(of(silent).checked_at).toBeNull();

    const [week] = await calendarOf(store.id, "2026-11-25", []);
    expect(week.toApprove.map((d) => d.id).sort()).toEqual([good, silent].sort());
  });

  it("clears a post's verdict when its words change, as its picture changes with them", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    expect(await editSocialPost(member, { id: bad, caption: "A slow morning at the wheel." })).toEqual({ ok: true });
    const [row] = await db().execute<{ checked_at: string | null; check_problems: string[] }>(sql`select checked_at, check_problems from commerce.social_posts where id = ${bad}::uuid`);
    expect(row).toEqual({ checked_at: null, check_problems: [] });
  });

  it("refuses without an AI that sees pictures", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    expect(await checkSocialPosts(member, [good], "https://example.com", { connection: null, picture })).toMatchObject({ ok: false });
  });
});

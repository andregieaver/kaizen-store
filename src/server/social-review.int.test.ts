import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { OutgoingEmail } from "./email";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { sendSocialReviews } = await import("./social-review");

/**
 * The social media adviser's weekly review (D870 S1.5): to the person who asked the adviser, from Monday 08:00 in the store's time, once
 * a week, with the week's figures and the advice's words. A store made for the test (Europe/Oslo); the email is caught, not sent.
 */

const run = Date.now().toString(36);
let storeId: string;
let accountId: string;
// 30 November 2026 is a Monday.
const MONDAY_EARLY = new Date("2026-11-30T06:00:00Z"); // 07:00 in Oslo
const MONDAY_LATER = new Date("2026-11-30T09:00:00Z"); // 10:00 in Oslo

beforeAll(async () => {
  const slug = `review-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Rita', 'Review') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Review', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set time_zone = 'Europe/Oslo', setup_completed_at = coalesce(setup_completed_at, now()), status = 'active' where id = ${storeId}::uuid`);
  const [owner] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid and role = 'owner' limit 1`);
  accountId = String(owner.account_id);
  const advice = {
    verdicts: ["Your posts reach people.", "Reels reach most.", "Post the new bowl."],
    recommendations: [],
    calendar: [
      { day: "2026-12-01", channel: "instagram", productId: null, idea: "A reel of a bowl taking shape." },
      { day: "2026-12-12", channel: "facebook", productId: null, idea: "Next week's, not this." },
    ],
  };
  await db().execute(sql`
    insert into commerce.social_advice (store_id, facts, advice, created_by, created_at)
    values (${storeId}::uuid, '{}'::jsonb, ${JSON.stringify(advice)}::jsonb, ${accountId}::uuid, '2026-11-27T10:00:00Z')`);
  await db().execute(sql`
    insert into commerce.social_posts (store_id, channel, ref, topic, locale, caption, link, copied_at, created_at)
    values (${storeId}::uuid, 'instagram', 'reviewreview', 'x', 'nb-NO', 'Hello', 'https://example.com', '2026-11-26T12:00:00Z', '2026-11-26T11:00:00Z'),
           (${storeId}::uuid, 'facebook', 'reviewreview', 'x', 'nb-NO', 'Hello', 'https://example.com', null, '2026-11-26T11:00:00Z')`);
}, 60_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.social_reviews where store_id = ${storeId}::uuid`);
  await closeDb();
});

describe("the weekly social media review", () => {
  it("waits for Monday 08:00 in the store's time, then sends the week once to who asked the adviser", async () => {
    const sent: OutgoingEmail[] = [];
    const send = async (m: OutgoingEmail) => {
      sent.push(m);
      return { ok: true } as never;
    };
    await sendSocialReviews({ now: MONDAY_EARLY, send });
    expect(sent.filter((m) => m.storeId === storeId)).toEqual([]);

    await sendSocialReviews({ now: MONDAY_LATER, send });
    const mine = sent.filter((m) => m.storeId === storeId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: "social.weekly", idempotencyKey: `social.weekly:${storeId}:${accountId}:2026-11-30` });
    const [row] = await db().execute<Row>(sql`select facts, sent_at from commerce.social_reviews where store_id = ${storeId}::uuid`);
    const facts = row.facts as { posts: unknown; advice: { verdicts: string[]; planned: { day: string }[] } };
    // The week Monday 23 to Sunday 29 November: one post written (two channels, one reference), copied into one channel.
    expect(facts.posts).toEqual({ written: 1, copied: 1 });
    expect(facts.advice.verdicts).toHaveLength(3);
    // Only the coming week's planned posts.
    expect(facts.advice.planned.map((p) => p.day)).toEqual(["2026-12-01"]);
    expect(row.sent_at).not.toBeNull();

    await sendSocialReviews({ now: new Date("2026-12-01T09:00:00Z"), send });
    expect(sent.filter((m) => m.storeId === storeId)).toHaveLength(1);
  });
});

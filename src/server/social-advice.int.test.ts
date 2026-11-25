import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const { writeSocialAdvice, latestAdvice, ADVICE_KEPT } = await import("./social-advice");
const { getStore } = await import("./stores");
const { encryptSecret, parseKey } = await import("@/lib/secret-box");

/** The social media adviser (D870 S1.4) against a store made for the test, the model's answer handed in (`complete`). */

const run = Date.now().toString(36);
let member: Membership;
let storeId: string;

const answer = (body: unknown) => async () => ({ content: JSON.stringify(body), toolCalls: [] });
const GOOD = {
  verdicts: ["The shop is new, so there is little to go on yet.", "Instagram is not connected.", "Nothing has been posted from here yet."],
  recommendations: [
    { title: "Connect Instagram", why: "So the adviser can see what your posts reach.", kind: "connect_instagram", productId: null, topic: "", channels: [] },
    { title: "Tell people the shop is open", why: "A first post brings the first visits.", kind: "write", productId: null, topic: "The shop is open", channels: ["instagram", "facebook"] },
  ],
  calendar: [{ day: "2026-11-27", channel: "instagram", productId: null, idea: "A first look inside the workshop." }],
};

beforeAll(async () => {
  const slug = `advice-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Advice') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Advice', null) as id`);
  storeId = String(created.id);
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`advice-owner-${run}@example.com`}, 'Owner') returning id, email, name`);
  const store = (await getStore(slug))!;
  member = { account: { id: String(account.id), email: String(account.email), name: String(account.name) }, store, role: "owner" } as unknown as Membership;
  await db().execute(sql`
    insert into commerce.ai_providers (store_id, provider, api_key_encrypted, api_key_hint, enabled, text_model)
    values (${storeId}::uuid, 'openai', ${encryptSecret("sk-test", parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!)}, 'test', true, 'text-a')`);
}, 60_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.ai_providers where store_id = ${storeId}::uuid`);
  await closeDb();
});

describe("the social media adviser", () => {
  it("answers from the facts, keeps the checked answer with the facts it read, and gives it back as the newest", async () => {
    expect(await latestAdvice(storeId)).toBeNull();
    let told = "";
    const result = await writeSocialAdvice(member, {
      now: new Date("2026-11-25T12:00:00Z"),
      complete: async (_c, messages) => {
        told = String(messages[1].content);
        return { content: JSON.stringify(GOOD), toolCalls: [] };
      },
    });
    expect(result.ok).toBe(true);
    // The facts go to the model as data, and nothing else about the store.
    expect(told.startsWith("<facts>")).toBe(true);
    expect(JSON.parse(told.slice(7, -8))).toMatchObject({ store: { name: "Advice" }, instagram: { state: "none" } });
    const kept = await latestAdvice(storeId);
    expect(kept?.advice.verdicts).toHaveLength(3);
    expect(kept?.advice.recommendations.map((r) => r.kind)).toEqual(["connect_instagram", "write"]);
    expect(kept?.advice.calendar).toEqual([{ day: "2026-11-27", channel: "instagram", productId: null, idea: "A first look inside the workshop." }]);
    expect(kept?.facts.store.name).toBe("Advice");
  });

  it("keeps nothing from an answer it cannot use", async () => {
    const before = (await latestAdvice(storeId))!.id;
    const result = await writeSocialAdvice(member, { complete: answer({ ...GOOD, verdicts: ["Sales rose 300 %.", "Post more.", "Connect Instagram."] }) });
    expect(result).toEqual({ ok: false, problem: "The adviser's answer could not be used. Try again." });
    expect((await latestAdvice(storeId))!.id).toBe(before);
  });

  it(`keeps the newest ${ADVICE_KEPT} answers per store`, async () => {
    for (let i = 0; i < ADVICE_KEPT + 2; i++) await writeSocialAdvice(member, { complete: answer(GOOD) });
    const [n] = await db().execute<Row>(sql`select count(*)::int as n from commerce.social_advice where store_id = ${storeId}::uuid`);
    expect(Number(n.n)).toBe(ADVICE_KEPT);
  }, 60_000);
});

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const settings = await import("./docs-guide-settings");
const store = await import("./docs-guide-store");
const { takeChatTurn, VISITOR_LIMIT } = await import("./chat-turns");
const { BUDGETS, FAIL_CLOSED } = await import("./request-budget");
const { countGuideMiss, listDocsMisses } = await import("./docs-search");
const { RETENTION_STEPS, runRetention } = await import("./retention");

/**
 * The docs guide's plumbing (wave 14 unit E5, D444): its one row of settings, its conversations kept by a tab's token as the platform chat's
 * are (D216: ended after the desk's time, the transcript gone after the desk's period, the record after 24 months), its own limits beside the
 * platform chat's, and the questions it could not answer counted for the docs' gap list.
 */

const run = Date.now().toString(36);
const email = `docs-guide-${run}@example.com`;
let admin: { id: string };
let desk: Row | undefined;

beforeAll(async () => {
  const [row] = await db().execute<{ id: string }>(sql`insert into commerce.accounts (email, name, platform_admin) values (${email}, 'Pia Platform', true) returning id`);
  admin = { id: row.id };
  [desk] = await db().execute<Row>(sql`select mode, transcript_days, end_after_minutes from commerce.support_settings where store_id is null`);
  await db().execute(sql`delete from commerce.support_settings where store_id is null`);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.docs_guide`);
  await db().execute(sql`delete from commerce.docs_guide_conversations`);
  await db().execute(sql`delete from commerce.docs_search_misses where query like ${`%${run}%`}`);
  await db().execute(sql`delete from commerce.chat_usage where store_id is null and bucket like 'guide:%'`);
  // The audit log is append-only (D158), so the admin who saved stays with their entries.
  if (desk) {
    await db().execute(sql`
      insert into commerce.support_settings (store_id, mode, transcript_days, end_after_minutes) values (null, ${desk.mode}, ${desk.transcript_days}, ${desk.end_after_minutes})
      on conflict do nothing`);
  }
  await closeDb();
});

const account = () => ({ id: admin.id }) as never;

describe("the docs guide's settings (D444)", () => {
  it("is off with no name until saved, refuses being switched on without a name, and keeps what the admin saved, audited", async () => {
    await db().execute(sql`delete from commerce.docs_guide`);
    expect(await settings.getDocsGuideForEdit()).toEqual(settings.GUIDE_DEFAULTS);
    expect(await settings.saveDocsGuide(account(), { ...settings.GUIDE_DEFAULTS, enabled: true })).toEqual({ ok: false, problems: ["Give the guide a name before switching it on."] });
    const saved = await settings.saveDocsGuide(account(), {
      enabled: true,
      name: "Ada",
      occupation: "Docs guide",
      avatar: null,
      avatarStyle: null,
      greeting: { en: "Hi, I'm Ada. Ask me about the docs.", nb: "" },
      instructions: "Short answers.",
      dailyLimit: 200,
    });
    expect(saved).toEqual({ ok: true });
    expect(await settings.getDocsGuideForEdit()).toEqual({
      enabled: true,
      name: "Ada",
      occupation: "Docs guide",
      avatar: null,
      avatarStyle: null,
      greeting: { en: "Hi, I'm Ada. Ask me about the docs." },
      instructions: "Short answers.",
      dailyLimit: 200,
    });
    // Saved again, it is the same one row.
    expect((await settings.saveDocsGuide(account(), { ...(await settings.getDocsGuideForEdit()), dailyLimit: 300 })).ok).toBe(true);
    const [count] = await db().execute<Row>(sql`select count(*)::int as n, max(daily_limit) as limit from commerce.docs_guide`);
    expect(count).toEqual({ n: 1, limit: 300 });
    const [audited] = await db().execute<Row>(sql`select details from commerce.audit_log where account_id = ${admin.id}::uuid and action = 'platform.docs_guide_saved' order by created_at limit 1`);
    expect(audited.details).toEqual({ enabled: true, name: "Ada", dailyLimit: 200 });
    // Kaizena Flow's own chat agent is untouched: the guide is not a row of `chat_agents`.
    expect(await db().execute(sql`select 1 from commerce.chat_agents where name = 'Ada'`)).toHaveLength(0);
  });

  it("keeps the platform chat's periods: a day while Kaizena Flow's desk has support off, the desk's own otherwise", async () => {
    expect(await settings.guideKeeping(db())).toEqual({ endAfterMinutes: 30, transcriptDays: 1 });
    await db().execute(sql`insert into commerce.support_settings (store_id, mode, transcript_days, end_after_minutes) values (null, 'ai_first', 60, 45)`);
    expect(await settings.guideKeeping(db())).toEqual({ endAfterMinutes: 45, transcriptDays: 60 });
    await db().execute(sql`delete from commerce.support_settings where store_id is null`);
  });
});

describe("the docs guide's conversations (D444)", () => {
  it("are the tab's by its token, number their messages without gaps and give the model its history", async () => {
    const { conversation, token } = await store.openGuideConversation({ lang: "nb", page: "owners/getting-started/create-your-store" });
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const ref = { id: conversation.id, token };
    expect(await store.guideConversation({ id: conversation.id, token: "x".repeat(32) })).toBeNull();
    expect((await store.guideConversation(ref))?.lang).toBe("nb");
    expect(await store.addGuideMessage(conversation.id, "reader", "Hvordan legger jeg inn et produkt?")).toEqual({ seq: 1 });
    expect(await store.addGuideMessage(conversation.id, "ai", "Under Produkter.", { links: [{ title: "Legg inn ditt første produkt", href: "/no/docs/owners/getting-started/your-first-product" }], prompt: "abc123def456" })).toEqual({ seq: 2 });
    expect(await store.addGuideMessage(conversation.id, "reader", "   ")).toBeNull();
    const feed = await store.guideFeed(conversation.id, 1);
    expect(feed).toEqual([{ seq: 2, author: "ai", body: "Under Produkter.", at: expect.any(String), links: [{ title: "Legg inn ditt første produkt", href: "/no/docs/owners/getting-started/your-first-product" }] }]);
    // The prompt's version is kept for the platform, never shown to the reader.
    expect(JSON.stringify(feed)).not.toContain("abc123def456");
    expect(await store.guideHistory(conversation.id, 20)).toEqual([
      { role: "user", content: "Hvordan legger jeg inn et produkt?" },
      { role: "assistant", content: "Under Produkter." },
    ]);
    expect(await store.guideHistory(conversation.id, 1)).toEqual([{ role: "assistant", content: "Under Produkter." }]);
    // The token is kept only as its hash.
    const [row] = await db().execute<Row>(sql`select token_hash from commerce.docs_guide_conversations where id = ${conversation.id}::uuid`);
    expect(row.token_hash).not.toBe(token);
    expect(String(row.token_hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("counts answers that offered support, ends after the desk's time, reopens within a day and is gone after", async () => {
    const { conversation, token } = await store.openGuideConversation({ lang: "en", page: null });
    const ref = { id: conversation.id, token };
    await store.addGuideMessage(conversation.id, "reader", "Can I pay with crypto?");
    await store.addGuideMessage(conversation.id, "ai", "The docs do not cover that.", { support: { admin: "/admin/account/kaizen-support", email: null } });
    const [counted] = await db().execute<Row>(sql`select unanswered from commerce.docs_guide_conversations where id = ${conversation.id}::uuid`);
    expect(counted.unanswered).toBe(1);

    await db().execute(sql`update commerce.docs_guide_conversations set last_message_at = now() - interval '2 hours' where id = ${conversation.id}::uuid`);
    expect(await store.endIdleGuideConversations()).toBeGreaterThanOrEqual(1);
    const [ended] = await db().execute<Row>(sql`select ended_at from commerce.docs_guide_conversations where id = ${conversation.id}::uuid`);
    expect(ended.ended_at).not.toBeNull();
    // Within a day of its end it goes on, and a message opens it again.
    expect(await store.guideConversation(ref)).not.toBeNull();
    await store.addGuideMessage(conversation.id, "reader", "And with Vipps?");
    const [open] = await db().execute<Row>(sql`select ended_at, message_seq from commerce.docs_guide_conversations where id = ${conversation.id}::uuid`);
    expect(open).toEqual({ ended_at: null, message_seq: 3 });
    // Ended longer ago than that, the reader starts a new one.
    await db().execute(sql`update commerce.docs_guide_conversations set ended_at = now() - interval '25 hours' where id = ${conversation.id}::uuid`);
    expect(await store.guideConversation(ref)).toBeNull();
  });

  it("is anonymised a day after it ended while the desk has support off, and its record deleted after the records' period", async () => {
    const noSteps = () => Object.fromEntries(RETENTION_STEPS.filter((s) => !s.startsWith("support_")).map((s) => [s, async () => ({ count: 0 })]));
    const { conversation: recent } = await store.openGuideConversation({ lang: "en", page: "developers/overview/introduction" });
    const { conversation: old } = await store.openGuideConversation({ lang: "en", page: "developers/overview/introduction" });
    for (const c of [recent, old]) {
      await store.addGuideMessage(c.id, "reader", "What is a scope?");
      await store.addGuideMessage(c.id, "ai", "A scope names what a token may do.");
    }
    await db().execute(sql`update commerce.docs_guide_conversations set ended_at = now() - interval '2 hours' where id = ${recent.id}::uuid`);
    await db().execute(sql`update commerce.docs_guide_conversations set ended_at = now() - interval '25 hours' where id = ${old.id}::uuid`);
    const ran = await runRetention(new Date(), { steps: noSteps() });
    expect(ran.errors).toEqual([]);
    expect(ran.counts.support_transcripts).toBeGreaterThanOrEqual(1);
    const rows = await db().execute<Row>(sql`
      select id, token_hash, page_path, anonymised_at is not null as anonymised, message_seq, (select count(*)::int from commerce.docs_guide_messages m where m.conversation_id = c.id) as messages
      from commerce.docs_guide_conversations c where id in (${recent.id}::uuid, ${old.id}::uuid)`);
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    expect(byId.get(old.id)).toMatchObject({ token_hash: null, page_path: null, anonymised: true, message_seq: 2, messages: 0 });
    expect(byId.get(recent.id)).toMatchObject({ anonymised: false, messages: 2 });

    // The desk's own period, while support is on: 30 days keeps the day-old one.
    await db().execute(sql`insert into commerce.support_settings (store_id, mode, transcript_days) values (null, 'ai_first', 30)`);
    await db().execute(sql`update commerce.docs_guide_conversations set ended_at = now() - interval '3 days' where id = ${recent.id}::uuid`);
    await runRetention(new Date(), { steps: noSteps() });
    const [kept] = await db().execute<Row>(sql`select anonymised_at from commerce.docs_guide_conversations where id = ${recent.id}::uuid`);
    expect(kept.anonymised_at).toBeNull();
    await db().execute(sql`delete from commerce.support_settings where store_id is null`);

    await db().execute(sql`update commerce.docs_guide_conversations set ended_at = now() - interval '25 months' where id = ${old.id}::uuid`);
    await runRetention(new Date(), { steps: noSteps() });
    expect(await db().execute(sql`select 1 from commerce.docs_guide_conversations where id = ${old.id}::uuid`)).toHaveLength(0);
  });
});

describe("the docs guide's limits and gap list (D444)", () => {
  it("counts its turns apart from the platform chat's, per reader and per day", async () => {
    const reader = `reader-${run}`;
    await db().execute(sql`delete from commerce.chat_usage where store_id is null and bucket in ('guide:day', 'day')`);
    expect(await takeChatTurn(null, reader, 2, "guide:")).toBe("ok");
    expect(await takeChatTurn(null, `${reader}-2`, 2, "guide:")).toBe("ok");
    expect(await takeChatTurn(null, `${reader}-3`, 2, "guide:")).toBe("closed");
    // The platform chat's own day is untouched by the guide's.
    expect(await takeChatTurn(null, `${reader}-4`, 2)).toBe("ok");
    await db().execute(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count) values (null, ${`guide:v:${reader}-5`}, date_bin('10 minutes', now(), '2000-01-01'), ${VISITOR_LIMIT})`);
    expect(await takeChatTurn(null, `${reader}-5`, 1000, "guide:")).toBe("busy");
    // Its request budget refuses when it cannot count: every message asks the platform's AI.
    expect(BUDGETS.docs_guide).toEqual({ window: "minute", visitor: 10, store: 600 });
    expect(FAIL_CLOSED.has("docs_guide")).toBe(true);
    await db().execute(sql`delete from commerce.chat_usage where store_id is null and bucket in ('guide:day', 'day')`);
  });

  it("counts a question it could not answer beside the searches, once an hour a reader, never personal-looking words", async () => {
    const topic = `paying with crypto ${run}`;
    expect(await countGuideMiss(topic, "en", `r1-${run}`)).toBe(true);
    expect(await countGuideMiss(topic, "en", `r1-${run}`)).toBe(false);
    expect(await countGuideMiss(topic, "en", `r2-${run}`)).toBe(true);
    expect(await countGuideMiss(`kf_${"a".repeat(40)} ${run}`, "en", `r1-${run}`)).toBe(false);
    expect(await countGuideMiss(`write to ola@example.com ${run}`, "en", `r1-${run}`)).toBe(false);
    const [row] = await db().execute<Row>(sql`select misses, guide_misses from commerce.docs_search_misses where query = ${topic}`);
    expect(row).toEqual({ misses: 0, guide_misses: 2 });
    // A search that found nothing for the same words adds to the same row.
    await db().execute(sql`update commerce.docs_search_misses set misses = misses + 1 where query = ${topic}`);
    const listed = (await listDocsMisses()).find((m) => m.query === topic);
    expect(listed).toMatchObject({ misses: 1, guideMisses: 2, lang: "en" });
  });
});

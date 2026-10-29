import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { ASSISTANT_KEEP_MONTHS, readKeepMonths } from "@/lib/assistant-keep";
import { RETENTION_SEED } from "@/lib/retention";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("./document-html", () => ({ documentHtml: () => "<html></html>" }));

const fx = await import("./invoice-test-fixture");
const { assistantKeepOf, pruneAssistantConversations, saveAssistantKeep } = await import("./assistant-retention");
const { runRetention } = await import("./retention");

type Row = Record<string, unknown>;

/**
 * The AI manager's conversations kept for a period (wave 11 unit L, D391, docs/dpia-ai.md R6): messages and decided approvals older than the
 * store's period (or the rule's 12 months) go, a conversation left empty goes unless an autopilot plan or a waiting follow-up uses it, and
 * the owner's choice is saved and audited.
 */

const NOW = new Date();
const monthsAgo = (months: number, days = 0) => {
  const d = new Date(NOW.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
};

let store: Awaited<ReturnType<typeof fx.makeStore>>;
let accountId = "";
const email = `keep-${Date.now().toString(36)}@example.com`;

beforeAll(async () => {
  store = await fx.makeStore("assistant-keep");
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${email}, 'Keep Owner') returning id`);
  accountId = String(account.id);
}, 60_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.assistant_conversations where account_id = ${accountId}::uuid`);
  await closeDb();
});

/** A conversation whose messages were written at the given times; its last activity is the newest. */
async function conversation(storeId: string | null, writtenAt: string[]): Promise<string> {
  const newest = [...writtenAt].sort().at(-1)!;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.assistant_conversations (store_id, account_id, title, created_at, updated_at)
    values (${storeId}::uuid, ${accountId}::uuid, 'Kept?', ${writtenAt[0]}::timestamptz, ${newest}::timestamptz) returning id`);
  const id = String(row.id);
  for (const at of writtenAt) {
    await db().execute(sql`
      insert into commerce.assistant_messages (store_id, conversation_id, role, content, created_at)
      values (${storeId}::uuid, ${id}::uuid, 'assistant', 'Kari Nordmann ordered twice', ${at}::timestamptz)`);
  }
  return id;
}

const messageCount = async (id: string) => Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.assistant_messages where conversation_id = ${id}::uuid`))[0].n);
const exists = async (id: string) => (await db().execute(sql`select 1 from commerce.assistant_conversations where id = ${id}::uuid`)).length > 0;

describe("the AI manager's conversations kept for a period (D391)", () => {
  it("has the rule's period as its default", () => {
    const seed = RETENTION_SEED.find((r) => r.kind === "assistant_conversations");
    expect(seed).toMatchObject({ periodValue: ASSISTANT_KEEP_MONTHS, periodUnit: "months" });
    expect(readKeepMonths("")).toEqual({ ok: true, months: null });
    expect(readKeepMonths("12")).toEqual({ ok: true, months: null });
    expect(readKeepMonths("6")).toEqual({ ok: true, months: 6 });
    expect(readKeepMonths("0")).toEqual({ ok: false });
    expect(readKeepMonths("61")).toEqual({ ok: false });
    expect(readKeepMonths("2.5")).toEqual({ ok: false });
  });

  it("deletes old messages, then a conversation left empty, keeping what a plan or a waiting follow-up uses", async () => {
    const old = await conversation(store.storeId, [monthsAgo(13), monthsAgo(12, 2)]);
    const mixed = await conversation(store.storeId, [monthsAgo(14), monthsAgo(1)]);
    const recent = await conversation(store.storeId, [monthsAgo(11)]);
    const platform = await conversation(null, [monthsAgo(13)]);
    const followed = await conversation(store.storeId, [monthsAgo(13)]);
    await db().execute(sql`
      insert into commerce.assistant_follow_ups (store_id, account_id, conversation_id, task, due_at, time_zone)
      values (${store.storeId}::uuid, ${accountId}::uuid, ${followed}::uuid, 'Check the stock again', now() + interval '1 day', 'Europe/Oslo')`);

    let removed = 0;
    for (let round = 0; round < 5; round++) removed += await pruneAssistantConversations(NOW, ASSISTANT_KEEP_MONTHS, 500);
    expect(removed).toBeGreaterThanOrEqual(7);

    expect(await exists(old)).toBe(false);
    expect(await exists(platform)).toBe(false);
    expect(await exists(mixed)).toBe(true);
    expect(await messageCount(mixed)).toBe(1);
    expect(await exists(recent)).toBe(true);
    expect(await messageCount(recent)).toBe(1);
    // The waiting follow-up keeps its conversation; its old message still goes.
    expect(await exists(followed)).toBe(true);
    expect(await messageCount(followed)).toBe(0);
  });

  it("follows the store owner's own period, saved and audited", async () => {
    const owner = { account: { id: accountId }, store: { id: store.storeId } } as never;
    expect(await saveAssistantKeep(owner, "99")).toEqual({ ok: false });
    expect(await saveAssistantKeep(owner, "3")).toEqual({ ok: true, months: 3 });
    expect(await assistantKeepOf(store.storeId)).toBe(3);
    const [entry] = await db().execute<Row>(sql`
      select details from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'store.assistant_keep' order by created_at desc limit 1`);
    expect(entry.details).toMatchObject({ before: null, after: 3 });

    const four = await conversation(store.storeId, [monthsAgo(4)]);
    const two = await conversation(store.storeId, [monthsAgo(2)]);
    const run = await runRetention(NOW);
    expect(run.errors.filter((e) => e.step === "assistant_conversations")).toEqual([]);
    expect(run.counts.assistant_conversations).toBeGreaterThanOrEqual(2);
    expect(await exists(four)).toBe(false);
    expect(await exists(two)).toBe(true);

    // Back to the default.
    expect(await saveAssistantKeep(owner, "")).toEqual({ ok: true, months: null });
    expect(await assistantKeepOf(store.storeId)).toBeNull();
  }, 180_000);
});

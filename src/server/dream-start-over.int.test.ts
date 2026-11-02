import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { passMembership } = await import("./auth");
const { latestDreamRun, startDreamOver } = await import("./dream-factory");

/**
 * Start over (D421): in the same store, before it opens, the newest run is set aside, what it made is cleared (its pages and the redirects
 * their deletion left, its products archived, its goals dropped, the front page unset) and a new run starts from the edited description.
 */

type Row = Record<string, unknown>;
const stamp = Date.now().toString(36);
let store: { id: string; slug: string; owner: string };
let started: Date;

async function newStore(name: string, email: string) {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Kari', ${name}) returning id`);
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}`;
  const [made] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${name}, null) as id`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where lower(email) = lower(${email})`);
  return { id: String(made.id), slug, owner: String(owner.id) };
}

const count = async (query: ReturnType<typeof sql>) => Number((await db().execute<Row>(query))[0]?.n ?? 0);

beforeAll(async () => {
  started = new Date(Date.now() - 1000);
  // The store is a copy of the Standard store made after the run "began": its pages and products count as made by the run.
  store = await newStore("Start over", `start-over-${stamp}@example.com`);
  await db().execute(sql`
    insert into commerce.dream_runs (store_id, account_id, prompt, test, status, created_at)
    values (${store.id}::uuid, ${store.owner}::uuid, 'Hand-thrown ceramic mugs for Norway, from my small workshop.', false, 'ready', ${started.toISOString()}::timestamptz)
  `);
  await db().execute(sql`insert into commerce.assistant_goals (store_id, title) values (${store.id}::uuid, 'First ten orders')`);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("starting the Dream Factory over (D421)", () => {
  it("refuses a description of the wrong length, clearing nothing", async () => {
    const member = (await passMembership(store.slug, store.owner))!;
    expect(await startDreamOver(member, "Too short")).toMatchObject({ ok: false });
    expect(await count(sql`select count(*)::int as n from commerce.pages where store_id = ${store.id}::uuid and type = 'page'`)).toBeGreaterThan(0);
    expect((await latestDreamRun(store.id))?.status).toBe("ready");
  });

  it("clears what the run made and starts a new run from the new description", async () => {
    const member = (await passMembership(store.slug, store.owner))!;
    const before = (await latestDreamRun(store.id))!;
    const result = await startDreamOver(member, "Hand-thrown ceramic bowls for Sweden, calm and warm, around 400 kroner.");
    expect(result).toMatchObject({ ok: true });

    const [old] = await db().execute<Row>(sql`select status, finished_at from commerce.dream_runs where id = ${before.id}::uuid`);
    expect(old.status).toBe("stopped");
    expect(old.finished_at).not.toBeNull();
    const now = (await latestDreamRun(store.id))!;
    expect(now.id).not.toBe(before.id);
    expect(now).toMatchObject({ status: "running", prompt: "Hand-thrown ceramic bowls for Sweden, calm and warm, around 400 kroner." });

    const since = started.toISOString();
    expect(await count(sql`select count(*)::int as n from commerce.pages where store_id = ${store.id}::uuid and type = 'page' and created_at >= ${since}::timestamptz`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from commerce.redirects where store_id = ${store.id}::uuid and origin = 'editor'`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from commerce.products where store_id = ${store.id}::uuid and status <> 'archived'`)).toBe(0);
    expect(await count(sql`select count(*)::int as n from commerce.assistant_goals where store_id = ${store.id}::uuid and status = 'active'`)).toBe(0);
    const [front] = await db().execute<Row>(sql`select front_page_id from commerce.stores where id = ${store.id}::uuid`);
    expect(front.front_page_id).toBeNull();
    const [cleared] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${store.id}::uuid and action = 'store.dream_cleared'`);
    expect(cleared.details).toMatchObject({ run: before.id });
  });

  it("starts over only before the store opens", async () => {
    await db().execute(sql`update commerce.stores set setup_completed_at = now() where id = ${store.id}::uuid`);
    const member = (await passMembership(store.slug, store.owner))!;
    expect(await startDreamOver(member, "Hand-thrown ceramic bowls for Sweden, calm and warm, around 400 kroner.")).toMatchObject({ ok: false });
  });
});

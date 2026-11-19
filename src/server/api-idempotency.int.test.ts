import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

/**
 * The Admin API's `Idempotency-Key` (`src/server/api-idempotency.ts`, PSI DATA-03; code review 1.9's next, FH9, D811): a client that sends a POST
 * again after a lost answer gets the first answer back, never a second order, refund or gift card. The same key with another method, path or
 * body is refused; while the first request runs, a second is told to try again; a failure Kaizena Flow could not answer is forgotten, so a retry
 * runs; answers are kept 24 hours. An owner's token and an app's installation keep their keys apart. `admin-api.int.test.ts` sends it through
 * the route; here each rule is held on its own.
 */

vi.mock("server-only", () => ({}));

const { claimIdempotencyKey, pruneApiIdempotency, requestHash, IDEMPOTENCY_HOURS } = await import("./api-idempotency");

const run = Date.now().toString(36);
let token: string;
let otherToken: string;
let grant: string;
const refund = (orderId: string) => `POST /orders/${orderId}/refunds`;
const body = JSON.stringify({ amount: "149.00", reason: "damaged" });

async function kept(owner: string, key: string, table: "token" | "app" = "token"): Promise<Row[]> {
  return table === "app"
    ? db().execute<Row>(sql`select request_hash, status, body from commerce.api_app_idempotency_keys where grant_id = ${owner}::uuid and key = ${key}`)
    : db().execute<Row>(sql`select request_hash, status, body from commerce.api_idempotency_keys where token_id = ${owner}::uuid and key = ${key}`);
}

/** Claims and expects to run: what the route does with a new key. */
async function claimToRun(...args: Parameters<typeof claimIdempotencyKey>) {
  const claim = await claimIdempotencyKey(...args);
  if (claim.kind !== "run") throw new Error(`expected to run, got ${JSON.stringify(claim)}`);
  return claim;
}

beforeAll(async () => {
  const slug = `idem-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Kari', ${slug}) returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Idempotency', null) as id`);
  const storeId = String(store.id);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${slug}@example.com`}`);
  const tokens = await db().execute<Row>(sql`
    insert into commerce.api_tokens (store_id, name, scopes, token_hash, prefix)
    values (${storeId}::uuid, 'Books', array['orders:write'], ${`hash-a-${run}`}, 'kf_a'), (${storeId}::uuid, 'Shop sync', array['orders:write'], ${`hash-b-${run}`}, 'kf_b')
    returning id
  `);
  [token, otherToken] = tokens.map((row) => String(row.id));
  const [client] = await db().execute<Row>(sql`
    insert into commerce.oauth_clients (kind, client_id, name, redirect_uris, secret_hash)
    values ('app', ${`kfapp_idem${run}`}, 'Idempotent app', array['https://app.example/cb'], 'hash') returning id
  `);
  const [installation] = await db().execute<Row>(sql`
    insert into commerce.oauth_grants (account_id, client_id, store_ids, store_id, scopes, resource, access)
    values (${String(owner.id)}::uuid, ${String(client.id)}::uuid, array[${storeId}::uuid], ${storeId}::uuid, array['orders:write'], 'admin', 'change')
    returning id
  `);
  grant = String(installation.id);
});

afterAll(async () => {
  await closeDb();
});

describe("a POST with an Idempotency-Key (claimIdempotencyKey)", () => {
  it("runs the first request once and answers the same request again with the first answer, kept once", async () => {
    const key = `refund-${run}-1`;
    const first = await claimToRun(token, key, refund("o1"), body);
    await first.save({ status: 201, body: { data: { id: "r1", amount_minor: 14_900, currency: "NOK" } } });
    for (let i = 0; i < 2; i += 1) {
      expect(await claimIdempotencyKey(token, key, refund("o1"), body)).toEqual({
        kind: "replay",
        answer: { status: 201, body: { data: { id: "r1", amount_minor: 14_900, currency: "NOK" } } },
      });
    }
    expect(await kept(token, key)).toEqual([{ request_hash: requestHash(refund("o1"), body), status: 201, body: { data: { id: "r1", amount_minor: 14_900, currency: "NOK" } } }]);
  });

  it("refuses the key for another order's refund, another amount or another method, so one answer never stands for another request", async () => {
    const key = `refund-${run}-2`;
    await (await claimToRun(token, key, refund("o1"), body)).save({ status: 201, body: { data: { id: "r2" } } });
    const refused = { kind: "refused", code: "invalid", message: "This Idempotency-Key was used for another request. Use a new key for a new request." };
    expect(await claimIdempotencyKey(token, key, refund("o2"), body)).toEqual(refused);
    expect(await claimIdempotencyKey(token, key, refund("o1"), JSON.stringify({ amount: "1490.00", reason: "damaged" }))).toEqual(refused);
    expect(await claimIdempotencyKey(token, key, `PATCH /orders/o1/refunds`, body)).toEqual(refused);
    // The first answer is kept as it was.
    expect(await kept(token, key)).toMatchObject([{ status: 201, body: { data: { id: "r2" } } }]);
  });

  it("tells a second request to try again while the first is still being answered, and runs only one of two sent together", async () => {
    const key = `order-${run}-3`;
    const target = "POST /draft-orders";
    const together = await Promise.all([0, 1, 2].map(() => claimIdempotencyKey(token, key, target, body)));
    expect(together.filter((claim) => claim.kind === "run")).toHaveLength(1);
    for (const claim of together.filter((c) => c.kind !== "run")) {
      expect(claim).toEqual({ kind: "refused", code: "conflict", message: "A request with this Idempotency-Key is still being answered. Try again." });
    }
    const running = together.find((claim) => claim.kind === "run");
    if (running?.kind !== "run") throw new Error("one runs");
    await running.save({ status: 201, body: { data: { number: "D-1001" } } });
    expect(await claimIdempotencyKey(token, key, target, body)).toMatchObject({ kind: "replay", answer: { status: 201 } });
  });

  it("forgets a request Kaizena Flow could not answer, so a retry runs, and never forgets an answer once kept", async () => {
    const key = `refund-${run}-4`;
    const first = await claimToRun(token, key, refund("o4"), body);
    await first.forget();
    expect(await kept(token, key)).toEqual([]);
    const retry = await claimToRun(token, key, refund("o4"), body);
    await retry.save({ status: 422, body: { error: { code: "invalid", message: "More than is left to refund." } } });
    // A refusal Kaizena Flow gave is an answer: kept, replayed, and not forgotten by a late forget().
    await retry.forget();
    expect(await claimIdempotencyKey(token, key, refund("o4"), body)).toEqual({
      kind: "replay",
      answer: { status: 422, body: { error: { code: "invalid", message: "More than is left to refund." } } },
    });
  });

  it("keeps each token's keys, and an app's, apart", async () => {
    const key = `shared-${run}`;
    await (await claimToRun(token, key, refund("o5"), body)).save({ status: 201, body: { data: { id: "token-answer" } } });
    // The same key from another token, or from an app's installation, is a new request of its own.
    const other = await claimToRun(otherToken, key, refund("o6"), body);
    await other.save({ status: 201, body: { data: { id: "other-answer" } } });
    const app = await claimToRun(grant, key, refund("o7"), body, "app");
    await app.save({ status: 201, body: { data: { id: "app-answer" } } });
    expect(await claimIdempotencyKey(token, key, refund("o5"), body)).toMatchObject({ answer: { body: { data: { id: "token-answer" } } } });
    expect(await claimIdempotencyKey(grant, key, refund("o7"), body, "app")).toMatchObject({ answer: { body: { data: { id: "app-answer" } } } });
    expect(await kept(grant, key, "app")).toHaveLength(1);
    expect(await kept(token, key)).toHaveLength(1);
  });

  it("refuses a key that is empty, too long or not printable before anything is kept", async () => {
    for (const key of ["", " ", "a b", "tab\tkey", "ø-key", "x".repeat(256)]) {
      expect(await claimIdempotencyKey(token, key, refund("o8"), body)).toEqual({ kind: "refused", code: "invalid", message: "Idempotency-Key is 1 to 255 printable characters." });
    }
    expect(await claimIdempotencyKey(token, "x".repeat(255), refund("o8"), body)).toMatchObject({ kind: "run" });
    const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.api_idempotency_keys where token_id = ${token}::uuid and key in ('', ' ', 'a b')`);
    expect(count.n).toBe(0);
  });

  it("stands for the whole request: its method and path with the ids in it, and its body", () => {
    expect(requestHash(refund("o1"), body)).toBe(requestHash(refund("o1"), body));
    expect(requestHash(refund("o1"), body)).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([requestHash(refund("o1"), body), requestHash(refund("o2"), body), requestHash(refund("o1"), `${body} `), requestHash(`${refund("o1")}\n${body}`, "")]).size).toBe(4);
  });
});

describe("keeping answers (pruneApiIdempotency)", () => {
  it("lets go of answers older than a day, a token's and an app's, and keeps the rest, so an old key runs again", async () => {
    const old = `old-${run}`;
    const young = `young-${run}`;
    await (await claimToRun(token, old, refund("o9"), body)).save({ status: 201, body: { data: { id: "old" } } });
    await (await claimToRun(grant, old, refund("o9"), body, "app")).save({ status: 201, body: { data: { id: "old-app" } } });
    await (await claimToRun(token, young, refund("o10"), body)).save({ status: 201, body: { data: { id: "young" } } });
    await db().execute(sql`update commerce.api_idempotency_keys set created_at = now() - make_interval(hours => ${IDEMPOTENCY_HOURS}, mins => 1) where token_id = ${token}::uuid and key = ${old}`);
    await db().execute(sql`update commerce.api_app_idempotency_keys set created_at = now() - make_interval(hours => ${IDEMPOTENCY_HOURS}, mins => 1) where grant_id = ${grant}::uuid and key = ${old}`);
    await db().execute(sql`update commerce.api_idempotency_keys set created_at = now() - make_interval(hours => ${IDEMPOTENCY_HOURS - 1}) where token_id = ${token}::uuid and key = ${young}`);

    expect(await pruneApiIdempotency()).toBeGreaterThanOrEqual(2);
    expect(await kept(token, old)).toEqual([]);
    expect(await kept(grant, old, "app")).toEqual([]);
    expect(await kept(token, young)).toHaveLength(1);
    expect(await claimIdempotencyKey(token, young, refund("o10"), body)).toMatchObject({ kind: "replay" });
    expect(await claimIdempotencyKey(token, old, refund("o9"), body)).toMatchObject({ kind: "run" });
  });
});

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const route = await import("@/app/api/platform/v1/[...path]/route");
const tokens = await import("./platform-api-tokens");

/**
 * Kaizena Flow's own API (C4 step 4, D517) against a real database: a token made only by a platform owner, shown once and kept as a hash;
 * read only, by scope; a store by its id or address name, never a demo store; requests by state; refused once revoked or once its maker is
 * no longer an owner.
 */

const run = Date.now().toString(36);
let owner: Account;
let reader: Account;
let storeId: string;

beforeAll(async () => {
  const [o] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`api-${run}@example.com`}, 'Aud', true) returning id`);
  const [r] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_role) values (${`api-read-${run}@example.com`}, 'Rolf', 'read_only') returning id`);
  owner = { id: String(o.id), email: "x", name: null, platformAdmin: true } as Account;
  reader = { id: String(r.id), email: "x", name: null, platformAdmin: false, platformRole: "read_only" } as Account;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`api-owner-${run}@example.com`}, 'Olga', 'Apiet') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`apiet-${run}`}, 'Apiet', null)`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${`apiet-${run}`}`);
  storeId = String(store.id);
  await db().execute(sql`insert into commerce.access_requests (email, name, store_name) values (${`api-waiting-${run}@example.com`}, 'Vera', ${`Venter ${run}`})`);
}, 120_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.platform_api_tokens where created_by in (${owner.id}::uuid, ${reader.id}::uuid)`);
  await closeDb();
});

const call = (path: string, token: string | null, method: "GET" | "POST" = "GET") => {
  const request = new Request(`https://kaizenaflow.com/api/platform/v1/${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const segments = path.split("?")[0].split("/");
  return method === "GET" ? route.GET(request, { params: Promise.resolve({ path: segments }) }) : route.POST();
};

describe("Kaizena Flow's own API (D517)", () => {
  it("makes a token only for a platform owner, shown once and kept as a hash", async () => {
    expect(await tokens.makePlatformToken(reader, { name: "Sheet", scopes: ["stores:read"] })).toEqual({ ok: false, problem: "owner" });
    expect(await tokens.makePlatformToken(owner, { name: " ", scopes: ["stores:read"] })).toEqual({ ok: false, problem: "name" });
    expect(await tokens.makePlatformToken(owner, { name: "Sheet", scopes: ["orders:read"] })).toEqual({ ok: false, problem: "scopes" });
    const made = await tokens.makePlatformToken(owner, { name: "Sheet", scopes: ["stores:read", "requests:read"] });
    if (!made.ok) throw new Error(made.problem);
    expect(made.token).toMatch(/^kfp_[A-Za-z0-9_-]{43}$/);
    const [row] = await db().execute<Row>(sql`select token_hash, prefix from commerce.platform_api_tokens where id = ${made.id}::uuid`);
    expect(String(row.token_hash)).not.toContain(made.token);
    expect(row.prefix).toBe(made.token.slice(0, 8));
    expect((await tokens.listPlatformTokens()).find((t) => t.id === made.id)).toMatchObject({ name: "Sheet", scopes: ["stores:read", "requests:read"] });
  });

  it("reads by scope, a store by id or address, requests by state; never writes", async () => {
    const made = await tokens.makePlatformToken(owner, { name: "Dashboard", scopes: ["stores:read", "requests:read"] });
    if (!made.ok) throw new Error(made.problem);
    expect((await call("stores", null)).status).toBe(401);
    expect((await call("stores", `kf_${"a".repeat(43)}`)).status).toBe(401);
    expect((await call("figures", made.token)).status).toBe(403);
    expect((await call("orders", made.token)).status).toBe(404);
    expect((await call("stores", made.token, "POST")).status).toBe(405);

    const list = await call("stores?limit=100", made.token);
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: { id: string; slug: string }[] };
    expect(body.data.some((s) => s.id === storeId)).toBe(true);
    const byId = (await (await call(`stores/${storeId}`, made.token)).json()) as { slug: string };
    expect(byId.slug).toBe(`apiet-${run}`);
    const bySlug = (await (await call(`stores/apiet-${run}`, made.token)).json()) as { id: string };
    expect(bySlug.id).toBe(storeId);
    const [template] = await db().execute<Row>(sql`select slug from commerce.stores where is_template limit 1`);
    if (template) expect((await call(`stores/${String(template.slug)}`, made.token)).status).toBe(404);

    const waiting = (await (await call("requests?status=pending&limit=100", made.token)).json()) as { data: { store_name: string; email: string }[] };
    expect(waiting.data.map((r) => r.store_name)).toContain(`Venter ${run}`);
    const approved = (await (await call("requests?status=approved&limit=100", made.token)).json()) as { data: { store_name: string }[] };
    expect(approved.data.map((r) => r.store_name)).not.toContain(`Venter ${run}`);
    expect((await call("requests?status=lost", made.token)).status).toBe(400);
    expect((await call("stores?limit=0", made.token)).status).toBe(400);
  });

  it("reads plans and figures with their scopes", async () => {
    const made = await tokens.makePlatformToken(owner, { name: "Numbers", scopes: ["plans:read", "figures:read"] });
    if (!made.ok) throw new Error(made.problem);
    const plans = (await (await call("plans", made.token)).json()) as { data: { prices: unknown[] }[] };
    expect(Array.isArray(plans.data)).toBe(true);
    const figures = (await (await call("figures", made.token)).json()) as { paying: number; recurring_revenue: unknown[] };
    expect(typeof figures.paying).toBe("number");
    expect(Array.isArray(figures.recurring_revenue)).toBe(true);
  });

  it("refuses a revoked token, and one whose maker is no longer an owner", async () => {
    const made = await tokens.makePlatformToken(owner, { name: "Gone", scopes: ["stores:read"] });
    if (!made.ok) throw new Error(made.problem);
    expect(await tokens.revokePlatformToken(reader, made.id)).toBe(false);
    expect(await tokens.revokePlatformToken(owner, made.id)).toBe(true);
    expect((await call("stores", made.token)).status).toBe(401);
    const kept = await tokens.makePlatformToken(owner, { name: "Kept", scopes: ["stores:read"] });
    if (!kept.ok) throw new Error(kept.problem);
    expect((await call("stores", kept.token)).status).toBe(200);
    await db().execute(sql`update commerce.accounts set platform_admin = false, platform_role = 'read_only' where id = ${owner.id}::uuid`);
    expect((await call("stores", kept.token)).status).toBe(401);
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where account_id = ${owner.id}::uuid and action like 'platform.api_token_%'`);
    expect(Number(audited.n)).toBeGreaterThanOrEqual(5);
  });
});

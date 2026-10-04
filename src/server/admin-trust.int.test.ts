import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { makeAccount, makeStore } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const act = await import("./activity");
const team = await import("./team");

type Row = Record<string, unknown>;

/**
 * What the admin's pages read for the wave 1 trust lane (docs/wave-1-trust.md 2.6, 2.9): the platform's own activity log (entries with no store,
 * never a store's), the store's requirement of two-step sign-in read now, and what the platform's customer page says of an account's second step.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let admin: Awaited<ReturnType<typeof makeAccount>>;

async function put(storeId: string | null, accountId: string | null, action: string, at: string, area: string | null = null): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.audit_log (store_id, account_id, action, details, area, created_at)
    values (${storeId}::uuid, ${accountId}::uuid, ${action}, '{}'::jsonb, ${area}, ${at}::timestamptz) returning id
  `);
  return Number(row.id);
}

beforeAll(async () => {
  store = await makeStore("admintrust");
  admin = await makeAccount("trust-admin", { platformAdmin: true });
});
afterAll(async () => {
  await closeDb();
});

describe("the platform's activity log", () => {
  it("lists entries with no store, newest first, and never one of a store", async () => {
    const mine = await put(null, admin.id, "account.two_step_enrolled", "2026-01-10T10:00:00Z");
    const later = await put(null, admin.id, "account.recovery_code_used", "2026-01-11T10:00:00Z");
    const storeEntry = await put(store.id, admin.id, "product.created", "2026-01-12T10:00:00Z");
    const page = await act.listPlatformActivity({ accountId: admin.id }, null, 50);
    const ids = page.entries.map((e) => e.id);
    expect(ids).toContain(mine);
    expect(ids).toContain(later);
    expect(ids).not.toContain(storeEntry);
    expect(ids.indexOf(later)).toBeLessThan(ids.indexOf(mine));
    expect(page.entries.find((e) => e.id === later)).toMatchObject({ email: admin.email, area: "account", summary: expect.stringContaining("used a recovery code") });
  });

  it("filters by area, action, and day, in UTC", async () => {
    const id = await put(null, admin.id, "platform.request_approved", "2026-02-05T23:30:00Z");
    expect((await act.listPlatformActivity({ accountId: admin.id, area: "platform" })).entries.map((e) => e.id)).toContain(id);
    expect((await act.listPlatformActivity({ accountId: admin.id, area: "orders" })).entries.map((e) => e.id)).not.toContain(id);
    expect((await act.listPlatformActivity({ accountId: admin.id, action: "platform.request_approved" })).entries.map((e) => e.id)).toContain(id);
    expect((await act.listPlatformActivity({ accountId: admin.id, from: "2026-02-05", to: "2026-02-05" })).entries.map((e) => e.id)).toEqual([id]);
    expect((await act.listPlatformActivity({ accountId: admin.id, from: "2026-02-06", to: "2026-02-06" })).entries).toEqual([]);
    // Anything that is not a day is ignored, not trusted.
    expect((await act.listPlatformActivity({ accountId: admin.id, from: "yesterday" })).entries.map((e) => e.id)).toContain(id);
  });

  it("pages by a cursor that holds while new entries arrive", async () => {
    const who = await makeAccount("trust-pager");
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push(await put(null, who.id, "account.two_step_passed", `2026-03-0${i + 1}T10:00:00Z`));
    const first = await act.listPlatformActivity({ accountId: who.id }, null, 2);
    expect(first.entries).toHaveLength(2);
    expect(first.next).toBe(first.entries[1].id);
    await put(null, who.id, "account.two_step_passed", "2026-03-09T10:00:00Z");
    const second = await act.listPlatformActivity({ accountId: who.id }, first.next, 2);
    expect(second.entries.map((e) => e.id)).toEqual([ids[2], ids[1]]);
    const last = await act.listPlatformActivity({ accountId: who.id }, second.next, 2);
    expect(last.entries.map((e) => e.id)).toEqual([ids[0]]);
    expect(last.next).toBeNull();
  });

  it("offers as filters only the people and actions that appear in it", async () => {
    await put(null, admin.id, "account.two_step_reset", "2026-04-01T10:00:00Z");
    const filters = await act.platformActivityFilters();
    expect(filters.people.map((p) => p.accountId)).toContain(admin.id);
    expect(filters.actions).toContain("account.two_step_reset");
    expect(filters.actions).not.toContain("product.created");
  });
});

describe("the team's reads", () => {
  it("reads a store's requirement of two-step sign-in now", async () => {
    expect(await team.twoStepRequired(store.id)).toBe(false);
    await db().execute(sql`update commerce.stores set require_two_step = true where id = ${store.id}::uuid`);
    expect(await team.twoStepRequired(store.id)).toBe(true);
    await db().execute(sql`update commerce.stores set require_two_step = false where id = ${store.id}::uuid`);
    expect(await team.twoStepRequired(store.id)).toBe(false);
  });

  it("says what the customer page needs of an account's second step: seen, waiting to be set up again, or neither", async () => {
    const person = await makeAccount("trust-person");
    expect(await team.twoStepOfAccount(person.id)).toEqual({ seen: false, waitingToSetUp: false });
    await db().execute(sql`update commerce.accounts set two_step_since = now() where id = ${person.id}::uuid`);
    expect(await team.twoStepOfAccount(person.id)).toEqual({ seen: true, waitingToSetUp: false });
    await db().execute(sql`update commerce.accounts set two_step_since = null, two_step_reenrol_at = now() where id = ${person.id}::uuid`);
    expect(await team.twoStepOfAccount(person.id)).toEqual({ seen: false, waitingToSetUp: true });
    expect(await team.twoStepOfAccount("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

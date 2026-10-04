import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { addMember, makeAccount, makeStore, membershipOf } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const act = await import("./activity");
const roles = await import("./store-roles");

type Row = Record<string, unknown>;

/**
 * The activity log's page (wave 1, 1f, docs/wave-1-trust.md 2.9): by person, area, period and action, paged by a cursor that holds under new
 * entries; an owner sees every entry of the store, anyone else the areas they can read and their own; another store's entries and the
 * platform's never appear.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let other: Awaited<ReturnType<typeof makeStore>>;
let admin: Awaited<ReturnType<typeof makeAccount>>;
let clerk: Awaited<ReturnType<typeof makeAccount>>;
let owner: Awaited<ReturnType<typeof membershipOf>>;
let adminM: Awaited<ReturnType<typeof membershipOf>>;
let clerkM: Awaited<ReturnType<typeof membershipOf>>;

type Seed = { storeId: string | null; accountId: string | null; action: string; area?: string | null; at: string; targetType?: string; targetId?: string; label?: string; changes?: unknown };
async function put(seed: Seed): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.audit_log (store_id, account_id, action, details, area, target_type, target_id, changes, created_at)
    values (${seed.storeId}::uuid, ${seed.accountId}::uuid, ${seed.action}, ${JSON.stringify(seed.label ? { label: seed.label } : {})}::jsonb, ${seed.area ?? null},
      ${seed.targetType ?? null}, ${seed.targetId ?? null}, ${seed.changes ? JSON.stringify(seed.changes) : null}::jsonb, ${seed.at}::timestamptz)
    returning id
  `);
  return Number(row.id);
}

beforeAll(async () => {
  store = await makeStore("activity");
  other = await makeStore("activity2");
  admin = await makeAccount("act-admin");
  clerk = await makeAccount("act-clerk");
  await addMember(store.id, admin.id, "admin");
  await roles.ensureStoreRoles(store.id);
  const [orders] = await db().execute<Row>(sql`select id from commerce.store_roles where store_id = ${store.id}::uuid and template = 'orders'`);
  await addMember(store.id, clerk.id, "admin", { roleId: String(orders.id) });
  owner = await membershipOf(store.slug, store.account, "owner");
  adminM = await membershipOf(store.slug, admin, "admin");
  const [role] = await db().execute<Row>(sql`select name, permissions from commerce.store_roles where id = ${String(orders.id)}::uuid`);
  clerkM = await membershipOf(store.slug, clerk, "admin", { permissions: (role.permissions as string[]).map(String), roleName: String(role.name) });

  const o = store.account.id;
  await put({ storeId: store.id, accountId: admin.id, action: "product.updated", area: "products", at: "2026-03-10T10:00:00Z", targetType: "product", targetId: "p1", label: "Demo: Lampe", changes: { title: { from: "Lamp", to: "Lampe" } } });
  await put({ storeId: store.id, accountId: o, action: "discount.created", area: "marketing", at: "2026-03-11T09:00:00Z", targetType: "discount", targetId: "d1", label: "SPRING" });
  await put({ storeId: store.id, accountId: clerk.id, action: "order.refunded", area: "orders", at: "2026-03-12T09:00:00Z" });
  await put({ storeId: store.id, accountId: o, action: "staff.invited", area: "staff", at: "2026-03-13T09:00:00Z", targetType: "account", targetId: "a1", label: "anna@example.com" });
  await put({ storeId: store.id, accountId: o, action: "store.theme_updated", area: "website", at: "2026-03-14T09:00:00Z" });
  // A row from before the area column: its area comes from its action.
  await put({ storeId: store.id, accountId: admin.id, action: "shipping.updated", area: null, at: "2026-03-15T09:00:00Z" });
  await put({ storeId: store.id, accountId: clerk.id, action: "payments.provider_updated", area: "settings", at: "2026-03-16T09:00:00Z" });
  // Never seen here: the platform's, and another store's.
  await put({ storeId: null, accountId: o, action: "platform.plan_updated", area: "platform", at: "2026-03-12T10:00:00Z" });
  await put({ storeId: other.id, accountId: other.account.id, action: "discount.created", area: "marketing", at: "2026-03-12T11:00:00Z", label: "OTHER" });
});

afterAll(async () => {
  await closeDb();
});

const actions = (page: { entries: { action: string }[] }) => page.entries.map((e) => e.action);

describe("who sees what", () => {
  it("shows an owner every entry of the store, newest first, and never the platform's or another store's", async () => {
    const page = await act.listActivity(owner);
    // Newest first by the order they were written in; the store's own approval (written by the platform when it was made) came first of all.
    expect(actions(page)).toEqual(["payments.provider_updated", "shipping.updated", "store.theme_updated", "staff.invited", "order.refunded", "discount.created", "product.updated", "platform.access_approved"]);
    expect(page.next).toBeNull();
    expect(JSON.stringify(page)).not.toContain("OTHER");
  });

  it("shows a default admin the areas they can read, the team's too (they hold staff:read), but not the platform's own entry about the store", async () => {
    expect(actions(await act.listActivity(adminM))).toContain("staff.invited");
    expect(actions(await act.listActivity(adminM))).toHaveLength(7);
    expect(actions(await act.listActivity(adminM))).not.toContain("platform.access_approved");
  });

  it("shows a member with a role the areas they can read and their own entries, nothing else", async () => {
    // The orders template: orders:write and a view of customers, products and bookings. Not marketing, website, settings or the team.
    const page = await act.listActivity(clerkM);
    // Their own payment-settings entry is shown although settings is not theirs to read.
    expect(actions(page).sort()).toEqual(["order.refunded", "payments.provider_updated", "product.updated"].sort());
  });

  it("shows no entry of an area the member cannot read, even by asking for it", async () => {
    expect(actions(await act.listActivity(clerkM, { area: "marketing" }))).toEqual([]);
    expect(actions(await act.listActivity(clerkM, { area: "staff" }))).toEqual([]);
    expect(actions(await act.listActivity(clerkM, { accountId: store.account.id }))).toEqual([]);
  });

  it("needs staff:read for the team's entries", async () => {
    const noTeam = await membershipOf(store.slug, admin, "admin", { permissions: ["orders:read", "marketing:read"] });
    const got = actions(await act.listActivity(noTeam, { area: "staff" }));
    expect(got).toEqual([]);
    expect(act.readableAreas(noTeam)).toEqual(["orders", "marketing"]);
    expect(act.readableAreas(owner)).toContain("staff");
  });

  it("another store's member sees nothing of this store: every query carries the store id", async () => {
    const foreign = await membershipOf(other.slug, other.account, "owner");
    const page = await act.listActivity(foreign);
    expect(actions(page)).toEqual(["discount.created", "platform.access_approved"]);
    expect(page.entries[0].target).toBeNull();
  });
});

describe("filters", () => {
  it("by person, by area, by action and by period in the store's days (Oslo: 13 March ends at 23:00 UTC the day before, in winter time)", async () => {
    expect(actions(await act.listActivity(owner, { accountId: admin.id }))).toEqual(["shipping.updated", "product.updated"]);
    expect(actions(await act.listActivity(owner, { area: "settings" }))).toEqual(["payments.provider_updated", "shipping.updated"]);
    expect(actions(await act.listActivity(owner, { action: "discount.created" }))).toEqual(["discount.created"]);
    expect(actions(await act.listActivity(owner, { from: "2026-03-12", to: "2026-03-13" }))).toEqual(["staff.invited", "order.refunded"]);
    expect(actions(await act.listActivity(owner, { from: "2026-03-14" }))).toHaveLength(4);
    expect(actions(await act.listActivity(owner, { to: "2026-03-10" }))).toEqual(["product.updated"]);
    // Combined.
    expect(actions(await act.listActivity(owner, { area: "products", accountId: admin.id, from: "2026-03-01", to: "2026-03-31" }))).toEqual(["product.updated"]);
    expect(actions(await act.listActivity(owner, { area: "products", accountId: store.account.id }))).toEqual([]);
  });

  it("a day is the store's: an entry just after local midnight belongs to the new day", async () => {
    await db().execute(sql`update commerce.stores set time_zone = 'Pacific/Auckland' where id = ${store.id}::uuid`);
    try {
      const zoned = await membershipOf(store.slug, store.account, "owner");
      // 2026-03-13T09:00Z is 22:00 on the 13th in Auckland (NZDT, +13); 2026-03-12T09:00Z is 22:00 on the 12th, and 2026-03-14T09:00Z on the 14th.
      expect(actions(await act.listActivity(zoned, { from: "2026-03-13", to: "2026-03-13" }))).toEqual(["staff.invited"]);
      // In Oslo (winter time, +1) the same day holds the entries from 2026-03-12T23:00Z to 2026-03-13T23:00Z: the same one.
    } finally {
      await db().execute(sql`update commerce.stores set time_zone = 'Europe/Oslo' where id = ${store.id}::uuid`);
    }
  });

  it("ignores a filter it cannot read (an unknown area, a date that is not one) rather than failing", async () => {
    expect(actions(await act.listActivity(owner, { area: "nonsense" as never }))).toHaveLength(8);
    expect(actions(await act.listActivity(owner, { from: "yesterday", to: "2026-13-40" }))).toHaveLength(8);
  });
});

describe("what an entry says", () => {
  it("makes the sentence in code from the action and its target, and carries the changed fields", async () => {
    const page = await act.listActivity(owner, { area: "products" });
    expect(page.entries[0]).toMatchObject({
      action: "product.updated",
      area: "products",
      email: admin.email,
      target: { type: "product", id: "p1", label: "Demo: Lampe" },
      summary: "Changed the product Demo: Lampe",
      changes: { title: { from: "Lamp", to: "Lampe" } },
    });
    const invited = (await act.listActivity(owner, { action: "staff.invited" })).entries[0];
    expect(invited.summary).toBe("Invited anna@example.com");
  });

  it("takes an old entry's area from its action", async () => {
    const [entry] = (await act.listActivity(owner, { action: "shipping.updated" })).entries;
    expect(entry.area).toBe("settings");
  });

  it("lists the people the filter offers, past members included, and the actions this viewer may see", async () => {
    const gone = await makeAccount("act-gone");
    await addMember(store.id, gone.id, "admin");
    await db().execute(sql`update commerce.store_members set disabled_at = now() where store_id = ${store.id}::uuid and account_id = ${gone.id}::uuid`);
    const people = await act.activityPeople(owner);
    expect(people.find((p) => p.accountId === gone.id)).toMatchObject({ current: false });
    expect(people.find((p) => p.accountId === admin.id)).toMatchObject({ current: true });
    expect(await act.activityActions(clerkM)).toEqual(["order.refunded", "payments.provider_updated", "product.updated"]);
  });
});

describe("paging", () => {
  it("pages by 50 with a cursor, newest first, and the cursor holds while new entries arrive", async () => {
    const busy = await makeStore("activity-busy");
    const member = await membershipOf(busy.slug, busy.account, "owner");
    await db().execute(sql`
      insert into commerce.audit_log (store_id, account_id, action, details, area, created_at)
      select ${busy.id}::uuid, ${busy.account.id}::uuid, 'discount.created', '{}'::jsonb, 'marketing', '2026-04-01T00:00:00Z'::timestamptz + (g || ' minutes')::interval
      from generate_series(1, 120) g
    `);
    const first = await act.listActivity(member);
    expect(first.entries).toHaveLength(50);
    expect(first.next).toBe(first.entries[49].id);
    // New entries arrive between the pages: they are newer, so they are not in the pages after the first.
    await db().execute(sql`insert into commerce.audit_log (store_id, account_id, action, details, area) values (${busy.id}::uuid, ${busy.account.id}::uuid, 'discount.deleted', '{}'::jsonb, 'marketing')`);
    const second = await act.listActivity(member, {}, first.next);
    const third = await act.listActivity(member, {}, second.next);
    expect(second.entries).toHaveLength(50);
    // 120 seeded and the store's own approval, which is the oldest of them all: it was made first.
    expect(third.entries).toHaveLength(21);
    expect(third.next).toBeNull();
    const seen = [...first.entries, ...second.entries, ...third.entries].map((e) => e.id);
    expect(new Set(seen).size).toBe(121);
    expect([...seen].sort((a, b) => b - a)).toEqual(seen);
    expect(seen).not.toContain(Number((await db().execute<Row>(sql`select max(id) as m from commerce.audit_log where store_id = ${busy.id}::uuid`))[0].m));
  });

  it("holds the page size to what is asked and never more than 200", async () => {
    const page = await act.listActivity(owner, {}, null, 3);
    expect(page.entries).toHaveLength(3);
    expect(page.next).toBe(page.entries[2].id);
    expect((await act.listActivity(owner, {}, null, 100000)).entries.length).toBeLessThanOrEqual(200);
  });
});

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { ROLE_TEMPLATE_KEYS, ROLE_TEMPLATES } from "@/lib/permissions";

import { addMember, auditRows, makeAccount, makeStore, membershipOf } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const r = await import("./store-roles");
const settings = await import("./settings");
const perms = await import("./permissions");

type Row = Record<string, unknown>;

/**
 * Roles, assigning them, and collaborators (wave 1, 1f, docs/wave-1-trust.md 2.7): the six templates made once and never again once deleted,
 * the owner's own roles held to the keys a role may contain, a role in use that cannot be deleted, one active owner always, and an
 * agency's account invited with an expiry. Only an owner changes any of it.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let owner: Awaited<ReturnType<typeof membershipOf>>;
let other: Awaited<ReturnType<typeof makeStore>>;
const roles = () => r.listStoreRoles(store.id);
const byName = async (name: string) => (await roles()).find((x) => x.name === name)!;

beforeAll(async () => {
  store = await makeStore("roles");
  other = await makeStore("roles2");
  owner = await membershipOf(store.slug, store.account, "owner");
});

afterAll(async () => {
  await closeDb();
});

describe("the role templates", () => {
  it("are made once for the store, as the six the frame names, with their keys", async () => {
    await r.ensureStoreRoles(store.id);
    const made = await roles();
    expect(made.map((x) => x.template)).toEqual([...ROLE_TEMPLATE_KEYS]);
    expect(made.map((x) => x.name)).toEqual(["Orders", "Products", "Marketing", "Content", "Analytics", "Read-only"]);
    expect(made.find((x) => x.template === "orders")?.permissions).toEqual(ROLE_TEMPLATES.orders.permissions);
    // Read-only: everything is view, nothing is change, and neither billing nor the team.
    const readOnly = made.find((x) => x.template === "read_only")!;
    expect(readOnly.permissions.every((p) => p.endsWith(":read"))).toBe(true);
    expect(readOnly.permissions.some((p) => p.startsWith("billing") || p.startsWith("staff"))).toBe(false);
  });

  it("are idempotent, also when the page loads race", async () => {
    await Promise.all([r.ensureStoreRoles(store.id), r.ensureStoreRoles(store.id), r.ensureStoreRoles(store.id)]);
    expect(await roles()).toHaveLength(6);
  });

  it("stay deleted: a template an owner removed is not made again", async () => {
    const marketing = await byName("Marketing");
    expect(await r.deleteRole(owner, marketing.id)).toEqual({ ok: true });
    await r.ensureStoreRoles(store.id);
    expect((await roles()).map((x) => x.name)).not.toContain("Marketing");
    expect(await roles()).toHaveLength(5);
  });

  it("take another name where the owner already has a role of that name", async () => {
    const fresh = await makeStore("roles3");
    const member = await membershipOf(fresh.slug, fresh.account, "owner");
    await r.createRole(member, { name: "orders", permissions: ["orders:read"] });
    await r.ensureStoreRoles(fresh.id);
    const names = (await r.listStoreRoles(fresh.id)).map((x) => x.name);
    expect(names).toContain("orders");
    expect(names).toContain("Orders (template)");
  });

  it("belong to the store they were made for", async () => {
    await r.ensureStoreRoles(other.id);
    const ids = new Set([...(await roles()), ...(await r.listStoreRoles(other.id))].map((x) => x.id));
    expect(ids.size).toBe(5 + 6);
  });
});

describe("making and changing a role", () => {
  it("makes a role from per-area levels: a change includes its view, and the write is logged with before and after", async () => {
    const made = await r.createRole(owner, { name: "  Shop   assistant ", permissions: ["orders:write", "products:read", "orders:write"] });
    expect(made.ok).toBe(true);
    const role = await byName("Shop assistant");
    expect(role.permissions).toEqual(["orders:read", "orders:write", "products:read"]);
    const log = await auditRows(store.id, "role.created");
    expect(log.at(-1)).toMatchObject({ area: "staff", target_type: "role", changes: { name: { from: null, to: "Shop assistant" }, permissions: { from: null, to: ["orders:read", "orders:write", "products:read"] } } });
  });

  it("refuses keys a role must not hold: the team, the plan and the owner key", async () => {
    for (const key of ["staff:write", "billing:write", "owner"]) {
      const result = await r.createRole(owner, { name: `Bad ${key}`, permissions: [key] });
      expect(result).toMatchObject({ ok: false, problems: [expect.stringContaining("only an owner can change the team or the plan")] });
    }
    // The database says the same.
    await expect(db().execute(sql`insert into commerce.store_roles (store_id, name, permissions) values (${store.id}::uuid, 'sneaky', array['staff:write'])`)).rejects.toThrow();
  });

  it("refuses an empty or very long name and a name already taken, whatever the case", async () => {
    expect(await r.createRole(owner, { name: "   ", permissions: [] })).toMatchObject({ ok: false });
    expect(await r.createRole(owner, { name: "x".repeat(61), permissions: [] })).toMatchObject({ ok: false });
    expect(await r.createRole(owner, { name: "SHOP ASSISTANT", permissions: [] })).toMatchObject({ ok: false, problems: [expect.stringContaining("already exists")] });
  });

  it("updates a role and logs the change; an unknown role is refused", async () => {
    const role = await byName("Shop assistant");
    expect(await r.updateRole(owner, role.id, { name: "Shop assistant", permissions: ["orders:write", "customers:read"] })).toEqual({ ok: true });
    const log = (await auditRows(store.id, "role.updated")).at(-1)!;
    expect(log.changes).toMatchObject({ permissions: { from: ["orders:read", "orders:write", "products:read"], to: ["orders:read", "orders:write", "customers:read"] } });
    expect(await r.updateRole(owner, "33333333-3333-4333-8333-333333333333", { name: "x", permissions: [] })).toMatchObject({ ok: false });
  });

  it("never touches another store's role", async () => {
    const [foreign] = await db().execute<Row>(sql`select id from commerce.store_roles where store_id = ${other.id}::uuid limit 1`);
    expect(await r.updateRole(owner, String(foreign.id), { name: "taken over", permissions: [] })).toMatchObject({ ok: false });
    expect(await r.deleteRole(owner, String(foreign.id))).toMatchObject({ ok: false });
    const [still] = await db().execute<Row>(sql`select name from commerce.store_roles where id = ${String(foreign.id)}::uuid`);
    expect(still.name).not.toBe("taken over");
  });

  it("is for owners only: an admin is refused every change, and says so", async () => {
    const admin = await makeAccount("role-admin");
    await addMember(store.id, admin.id, "admin");
    const member = await membershipOf(store.slug, admin, "admin");
    const refused = { ok: false, problems: ["You do not have access to this."] };
    expect(await r.createRole(member, { name: "Mine", permissions: [] })).toEqual(refused);
    expect(await r.updateRole(member, "33333333-3333-4333-8333-333333333333", { name: "x", permissions: [] })).toEqual(refused);
    expect(await r.deleteRole(member, "33333333-3333-4333-8333-333333333333")).toEqual(refused);
    expect(await r.assignRole(member, store.account.id, { kind: "admin" })).toEqual(refused);
    expect(await settings.inviteStaff(member, "someone@example.com", "admin")).toEqual(refused);
    expect(await settings.disableStaff(member, admin.id)).toEqual(refused);
    expect(await r.inviteCollaborator(member, "agency@example.com", null, 30)).toEqual(refused);
    expect(await r.extendCollaborator(member, admin.id, 30)).toEqual(refused);
  });
});

describe("giving a member a role", () => {
  it("assigns a custom role (the member is an admin holding it), then the default admin set, then owner; each logged before and after", async () => {
    const person = await makeAccount("holder");
    await addMember(store.id, person.id, "admin");
    const shop = await byName("Shop assistant");
    expect(await r.assignRole(owner, person.id, { kind: "role", roleId: shop.id })).toEqual({ ok: true });
    const [row] = await db().execute<Row>(sql`select role, role_id from commerce.store_members where store_id = ${store.id}::uuid and account_id = ${person.id}::uuid`);
    expect(row).toMatchObject({ role: "admin", role_id: shop.id });
    const members = await settings.listStaff(store.id);
    expect(members.find((m) => m.accountId === person.id)).toMatchObject({ role: "admin", roleName: "Shop assistant", kind: "staff" });
    expect(await r.assignRole(owner, person.id, { kind: "admin" })).toEqual({ ok: true });
    expect(await r.assignRole(owner, person.id, { kind: "owner" })).toEqual({ ok: true });
    const log = (await auditRows(store.id, "staff.role_assigned")).filter((l) => l.target_id === person.id);
    expect(log).toHaveLength(3);
    expect(log[0].changes).toMatchObject({ roleName: { from: null, to: "Shop assistant" } });
    expect(log[2].changes).toMatchObject({ role: { from: "admin", to: "owner" } });
    // An owner never carries a custom role (the database's check).
    const [now] = await db().execute<Row>(sql`select role, role_id from commerce.store_members where store_id = ${store.id}::uuid and account_id = ${person.id}::uuid`);
    expect(now).toMatchObject({ role: "owner", role_id: null });
  });

  it("keeps one active owner always: the last cannot be given another role", async () => {
    const solo = await makeStore("roles-solo");
    const member = await membershipOf(solo.slug, solo.account, "owner");
    expect(await r.assignRole(member, solo.account.id, { kind: "admin" })).toEqual({ ok: false, problems: ["The store must keep at least one active owner."] });
  });

  it("refuses someone who is not a member, a role of another store and a collaborator as owner", async () => {
    const stranger = await makeAccount("stranger");
    expect(await r.assignRole(owner, stranger.id, { kind: "admin" })).toMatchObject({ ok: false, problems: [expect.stringContaining("not a member")] });
    const person = await makeAccount("assignee");
    await addMember(store.id, person.id, "admin");
    const [foreign] = await db().execute<Row>(sql`select id from commerce.store_roles where store_id = ${other.id}::uuid limit 1`);
    expect(await r.assignRole(owner, person.id, { kind: "role", roleId: String(foreign.id) })).toMatchObject({ ok: false, problems: [expect.stringContaining("no longer exists")] });
    expect(await r.inviteCollaborator(owner, `agency-a-${Date.now()}@example.com`, null, 7)).toEqual({ ok: true });
    const [agency] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${store.id}::uuid and kind = 'collaborator' order by created_at desc limit 1`);
    expect(await r.assignRole(owner, String(agency.account_id), { kind: "owner" })).toEqual({ ok: false, problems: ["A collaborator cannot be an owner."] });
  });
});

describe("a role in use cannot be deleted", () => {
  it("names who holds it, and lets it go once they have another", async () => {
    const role = await r.createRole(owner, { name: "In use", permissions: ["marketing:read"] });
    if (!role.ok) throw new Error("role");
    const person = await makeAccount("in-use");
    await addMember(store.id, person.id, "admin");
    await r.assignRole(owner, person.id, { kind: "role", roleId: role.id });
    const refused = await r.deleteRole(owner, role.id);
    expect(refused).toMatchObject({ ok: false, problems: [expect.stringContaining(person.email)] });
    expect((await roles()).find((x) => x.id === role.id)?.members).toBe(1);
    await r.assignRole(owner, person.id, { kind: "admin" });
    expect(await r.deleteRole(owner, role.id)).toEqual({ ok: true });
    expect((await auditRows(store.id, "role.deleted")).at(-1)).toMatchObject({ target_id: role.id, changes: { name: { from: "In use", to: null } } });
  });

  it("is also held by the database for a past member", async () => {
    const role = await r.createRole(owner, { name: "Past holder", permissions: [] });
    if (!role.ok) throw new Error("role");
    const person = await makeAccount("past");
    await addMember(store.id, person.id, "admin", { roleId: role.id });
    await db().execute(sql`update commerce.store_members set disabled_at = now() where store_id = ${store.id}::uuid and account_id = ${person.id}::uuid`);
    expect(await r.deleteRole(owner, role.id)).toMatchObject({ ok: false, problems: [expect.stringContaining("past member")] });
  });
});

describe("inviting staff with a role", () => {
  it("invites an admin with a custom role, resets an old collaborator's expiry, and logs it", async () => {
    const role = await byName("Shop assistant");
    const email = `invited-${Date.now()}@example.com`;
    expect(await settings.inviteStaff(owner, email, "admin", role.id)).toEqual({ ok: true });
    const staff = (await settings.listStaff(store.id)).find((m) => m.email === email)!;
    expect(staff).toMatchObject({ role: "admin", roleName: "Shop assistant", kind: "staff", expiresAt: null });
    expect((await auditRows(store.id, "staff.invited")).at(-1)).toMatchObject({ area: "staff", target_type: "account", changes: { email: { from: null, to: email }, roleName: { from: null, to: "Shop assistant" } } });
    expect(await settings.inviteStaff(owner, email, "admin")).toMatchObject({ ok: false, problems: [expect.stringContaining("already has access")] });
    expect(await settings.inviteStaff(owner, "owner-with-role@example.com", "owner", role.id)).toMatchObject({ ok: false, problems: ["A custom role is for an admin."] });
    expect(await settings.inviteStaff(owner, "ghost-role@example.com", "admin", "33333333-3333-4333-8333-333333333333")).toMatchObject({ ok: false });
  });
});

describe("collaborators", () => {
  const email = () => `agency-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;

  it("are invited with a role and an expiry (30 days by default), show as collaborators with their end date, and never hold the team or the plan", async () => {
    const who = email();
    const now = new Date("2026-10-03T10:00:00Z");
    const role = await byName("Shop assistant");
    expect(await r.inviteCollaborator(owner, who, role.id, undefined, now)).toEqual({ ok: true });
    const staff = (await settings.listStaff(store.id)).find((m) => m.email === who)!;
    expect(staff).toMatchObject({ kind: "collaborator", role: "admin", roleName: "Shop assistant", expiresAt: "2026-11-02T10:00:00.000Z" });
    const [row] = await db().execute<Row>(sql`select a.id from commerce.accounts a where a.email = ${who}`);
    expect(perms.memberCan({ role: "admin", kind: "collaborator", permissions: ["orders:write", "staff:read"] }, "staff:read")).toBe(false);
    expect(perms.memberCan({ role: "admin", kind: "collaborator", permissions: null }, "billing:read")).toBe(false);
    expect(perms.memberCan({ role: "admin", kind: "collaborator", permissions: null }, "owner")).toBe(false);
    expect(perms.memberCan({ role: "admin", kind: "collaborator", permissions: ["orders:write"] }, "orders:read")).toBe(true);
    expect((await auditRows(store.id, "staff.collaborator_invited")).at(-1)).toMatchObject({ target_id: String(row.id), changes: { kind: { from: null, to: "collaborator" } } });
  });

  it("take 1 to 365 days and nothing else", async () => {
    for (const days of [0, 366, 1.5, "abc", -3]) expect(await r.inviteCollaborator(owner, email(), null, days)).toEqual({ ok: false, problems: ["Choose between 1 and 365 days."] });
    expect(await r.inviteCollaborator(owner, email(), null, 365)).toEqual({ ok: true });
    expect(await r.inviteCollaborator(owner, email(), null, "14")).toEqual({ ok: true });
  });

  it("can be an account that is a member of other stores, and cannot be invited twice while they have access", async () => {
    const who = email();
    expect(await r.inviteCollaborator(owner, who, null, 10)).toEqual({ ok: true });
    const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${who}`);
    await addMember(other.id, String(account.id), "admin");
    expect(await r.inviteCollaborator(owner, who, null, 10)).toMatchObject({ ok: false, problems: [expect.stringContaining("already has access")] });
  });

  it("are invited again after their time has run out, and extending gives them more time from now", async () => {
    const who = email();
    expect(await r.inviteCollaborator(owner, who, null, 5, new Date("2026-01-01T00:00:00Z"))).toEqual({ ok: true });
    // Their five days ended long ago: a new invitation is allowed.
    expect(await r.inviteCollaborator(owner, who, null, 5, new Date("2026-06-01T00:00:00Z"))).toEqual({ ok: true });
    const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${who}`);
    const now = new Date("2026-10-03T00:00:00Z");
    expect(await r.extendCollaborator(owner, String(account.id), 7, now)).toEqual({ ok: true });
    const [row] = await db().execute<Row>(sql`select expires_at, disabled_at from commerce.store_members where store_id = ${store.id}::uuid and account_id = ${String(account.id)}::uuid`);
    expect(new Date(String(row.expires_at)).toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(row.disabled_at).toBeNull();
    expect(await r.extendCollaborator(owner, store.account.id, 7)).toMatchObject({ ok: false, problems: [expect.stringContaining("not a collaborator")] });
    expect(await r.extendCollaborator(owner, String(account.id), 0)).toEqual({ ok: false, problems: ["Choose between 1 and 365 days."] });
    expect((await auditRows(store.id, "staff.collaborator_extended")).at(-1)).toMatchObject({ target_id: String(account.id) });
  });

  it("a collaborator row is never an owner and always ends (the database's checks)", async () => {
    const person = await makeAccount("check");
    await expect(addMember(store.id, person.id, "owner", { kind: "collaborator", expiresAt: new Date(Date.now() + 1000) })).rejects.toThrow();
    await expect(addMember(store.id, person.id, "admin", { kind: "collaborator", expiresAt: null })).rejects.toThrow();
  });

  it("another store's owner cannot invite into this store (the membership says whose store it is)", async () => {
    const foreign = await membershipOf(other.slug, other.account, "owner");
    expect(await r.inviteCollaborator(foreign, email(), null, 5)).toEqual({ ok: true });
    const [stray] = await db().execute<Row>(sql`select count(*)::int as n from commerce.store_members where store_id = ${store.id}::uuid and kind = 'collaborator' and invited_by = ${other.account.id}::uuid`);
    expect(stray.n).toBe(0);
  });
});

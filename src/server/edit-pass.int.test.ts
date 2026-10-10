import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { signGrant } from "@/lib/edit-grant";

import { addMember, makeAccount, makeStore } from "./trust-fixtures";

// The cookies of the request are this test's to set; the rest of the modules are the real ones.
const request = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name in request.cookies ? { name, value: request.cookies[name] } : undefined) }),
}));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const auth = await import("./auth");
const pass = await import("./edit-pass");
const permissions = await import("./permissions");
const roles = await import("./store-roles");

/**
 * The pass for changing words on a store's own domain (D193): the admin's word for a person a few minutes ago, looked up again each
 * time it is used. It names a store and an account, and is no one's once the account or the access is gone.
 */

type Row = Record<string, unknown>;
let store: Awaited<ReturnType<typeof makeStore>>;
let other: Awaited<ReturnType<typeof makeStore>>;
let readOnlyRole: string;

const asEdit = (member: { store: { id: string; slug: string }; account: { id: string } }) => pass.mintPass("edit", member)!;
const cookie = (token: string | null) => {
  request.cookies = token === null ? {} : { [pass.EDIT_COOKIE]: token };
};

beforeAll(async () => {
  store = await makeStore("pass-a");
  other = await makeStore("pass-b");
  await roles.ensureStoreRoles(store.id);
  const [role] = await db().execute<Row>(sql`select id from commerce.store_roles where store_id = ${store.id}::uuid and template = 'read_only'`);
  readOnlyRole = String(role.id);
});

afterEach(() => cookie(null));

afterAll(async () => {
  await closeDb();
});

describe("the member an editing pass names", () => {
  it("is found with their role, like a signed-in member of the store", async () => {
    const member = await auth.passMembership(store.slug, store.account.id);
    expect(member).toMatchObject({ role: "owner", kind: "staff" });
    expect(member?.store.id).toBe(store.id);
    expect(member?.account.id).toBe(store.account.id);
  });

  it("is no one for an account that is not a member of that store, an unknown store or an unknown account", async () => {
    const stranger = await makeAccount("stranger");
    expect(await auth.passMembership(store.slug, stranger.id)).toBeNull();
    expect(await auth.passMembership(store.slug, other.account.id)).toBeNull();
    expect(await auth.passMembership("no-such-store-here", store.account.id)).toBeNull();
    expect(await auth.passMembership(store.slug, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("is no one once their access is taken away, has ended or their account is disabled", async () => {
    const member = await makeAccount("member");
    await addMember(store.id, member.id, "admin");
    expect(await auth.passMembership(store.slug, member.id)).toMatchObject({ role: "admin" });

    await db().execute(sql`update commerce.store_members set disabled_at = now() where store_id = ${store.id}::uuid and account_id = ${member.id}::uuid`);
    expect(await auth.passMembership(store.slug, member.id)).toBeNull();

    await addMember(store.id, member.id, "admin", { kind: "collaborator", expiresAt: new Date(Date.now() - 60_000) });
    expect(await auth.passMembership(store.slug, member.id)).toBeNull();
    await addMember(store.id, member.id, "admin", { kind: "collaborator", expiresAt: new Date(Date.now() + 3_600_000) });
    expect(await auth.passMembership(store.slug, member.id)).toMatchObject({ kind: "collaborator" });

    await db().execute(sql`update commerce.accounts set disabled_at = now() where id = ${member.id}::uuid`);
    expect(await auth.passMembership(store.slug, member.id)).toBeNull();
  });
});

describe("the request's pass", () => {
  it("gives the member it names in the store it names, who holds the key", async () => {
    cookie(asEdit({ store, account: store.account }));
    expect(await permissions.checkPassPermission(store.slug, "website:write")).toMatchObject({ role: "owner" });
    expect(await permissions.checkPassPageTypeAccess(store.slug, "page", "write")).not.toBeNull();
    expect(await permissions.checkPassPageTypeAccess(store.slug, "article", "write")).not.toBeNull();
  });

  it("holds nothing the person's role does not: a read-only member cannot change words", async () => {
    const reader = await makeAccount("reader");
    await addMember(store.id, reader.id, "admin", { roleId: readOnlyRole });
    cookie(asEdit({ store, account: reader }));
    expect(await pass.passMember(store.slug)).not.toBeNull();
    expect(await permissions.checkPassPermission(store.slug, "website:read")).not.toBeNull();
    expect(await permissions.checkPassPermission(store.slug, "website:write")).toBeNull();
    expect(await permissions.checkPassPageTypeAccess(store.slug, "page", "write")).toBeNull();
  });

  it("is no pass for another store, whoever it names", async () => {
    cookie(asEdit({ store: other, account: other.account }));
    expect(await pass.passMember(store.slug)).toBeNull();
    // Nor does a pass for this store make its person a member of the other.
    cookie(asEdit({ store, account: store.account }));
    expect(await pass.passMember(other.slug)).toBeNull();
    expect(await permissions.checkPassPermission(other.slug, "website:write")).toBeNull();
  });

  it("is nothing without a cookie, with the link's token in its place, with one that ran out or one altered", async () => {
    cookie(null);
    expect(await pass.passMember(store.slug)).toBeNull();
    // The admin's link is the other kind of token and opens only the exchange.
    cookie(pass.mintPass("enter", { store, account: store.account }));
    expect(await pass.passMember(store.slug)).toBeNull();
    // Over: made an hour ago.
    const key = Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY!, "base64");
    cookie(signGrant(key, { kind: "edit", storeId: store.id, store: store.slug, account: store.account.id }, Date.now() - 3_600_000));
    expect(await pass.passMember(store.slug)).toBeNull();
    // Altered: the account swapped for another.
    const good = asEdit({ store, account: store.account });
    const [body, signature] = good.split(".");
    const fields = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown[];
    fields[4] = other.account.id;
    cookie(`${Buffer.from(JSON.stringify(fields)).toString("base64url")}.${signature}`);
    expect(await pass.passMember(store.slug)).toBeNull();
    // And one signed with another key.
    cookie(signGrant(randomBytes(32), { kind: "edit", storeId: store.id, store: store.slug, account: store.account.id }));
    expect(await pass.passMember(store.slug)).toBeNull();
  });

  it("ends with the person's access, though the cookie is still good", async () => {
    const leaver = await makeAccount("leaver");
    await addMember(store.id, leaver.id, "admin");
    cookie(asEdit({ store, account: leaver }));
    expect(await permissions.checkPassPermission(store.slug, "website:write")).not.toBeNull();
    await db().execute(sql`update commerce.store_members set disabled_at = now() where store_id = ${store.id}::uuid and account_id = ${leaver.id}::uuid`);
    expect(await permissions.checkPassPermission(store.slug, "website:write")).toBeNull();
  });

  it("is made only where the server has a key, and its cookie is the host's alone, closed to scripts, for the editing routes", () => {
    const cookieOf = pass.passCookie("token", true);
    expect(cookieOf).toMatchObject({ name: "kaizen_edit", httpOnly: true, secure: true, sameSite: "lax", path: "/api/platform/editor", maxAge: 1800 });
    expect(pass.endedPassCookie(true)).toMatchObject({ name: "kaizen_edit", value: "", maxAge: 0, path: "/api/platform/editor", httpOnly: true });
    expect(pass.mintPass("edit", { store, account: store.account })).toEqual(expect.stringContaining("."));
  });
});

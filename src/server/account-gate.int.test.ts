import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { addMember, auditRows, fakeAuthState, fakeSupabase, linkAuthUser, makeAccount, makeStore } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const auth = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => auth.client }));

const a = await import("./auth");

type Row = Record<string, unknown>;

/**
 * The two-step gate (wave 1, 1f, docs/wave-1-trust.md 2.8): `getAccount()` fails closed, so every caller of it is safe with no edit.
 * Enrolment is read from the signed claim or a server-side getUser() for aal1, never from the session cookie, and a store's own
 * requirement holds a member before that store's admin only. The Auth client is a stand-in; the database is real.
 */

let state = fakeAuthState();
const signIn = (overrides: Parameters<typeof fakeAuthState>[0]) => {
  state = fakeAuthState(overrides);
  auth.client = fakeSupabase(state);
};

let store: Awaited<ReturnType<typeof makeStore>>;
let other: Awaited<ReturnType<typeof makeStore>>;
let authUser: string;

beforeAll(async () => {
  store = await makeStore("gate");
  other = await makeStore("gate2");
  authUser = await linkAuthUser(store.account.id);
});

beforeEach(() => {
  delete process.env.ADMIN_TWO_STEP;
  signIn({ sub: authUser });
});

afterAll(async () => {
  await closeDb();
});

const factor = { id: "11111111-1111-4111-8111-111111111111", status: "verified" as const, factor_type: "totp" as const };

describe("getAccount() and the second step", () => {
  it("is null when nobody is signed in", async () => {
    signIn({ sub: null });
    expect(await a.getAccount()).toBeNull();
    expect(await a.getSessionAccount()).toBeNull();
  });

  it("lets an aal1 session with no factor in, when nothing requires one, and says where it stands", async () => {
    const account = await a.getAccount();
    expect(account?.id).toBe(store.account.id);
    expect(account?.assurance).toEqual({ level: "aal1", enrolled: false });
  });

  it("holds an enrolled account at aal1: null for every caller, and the page to send them to is the challenge", async () => {
    signIn({ sub: authUser, factors: [factor] });
    expect(await a.getAccount()).toBeNull();
    const held = await a.getAssurance();
    expect(held?.assurance).toEqual({ state: "challenge" });
    expect((await a.getSessionAccount())?.id).toBe(store.account.id);
    await expect(a.requireAccount()).rejects.toThrow("REDIRECT:/admin/sign-in/two-step");
  });

  it("lets the same account in at aal2, from the signed claim alone (no call to the Auth server)", async () => {
    signIn({ sub: authUser, factors: [factor], aal: "aal2" });
    expect((await a.getAccount())?.id).toBe(store.account.id);
    expect(state.calls).not.toContain("getUser");
  });

  it("never reads the cookie's own copy of the user: factors edited out of it change nothing", async () => {
    // The person edited the factor out of the cookie; the server still holds it.
    signIn({ sub: authUser, factors: [factor], cookieFactors: [] });
    expect(await a.getAccount()).toBeNull();
    // And the other way round: a factor planted in the cookie does not make an unenrolled account look enrolled.
    signIn({ sub: authUser, factors: [], cookieFactors: [factor] });
    expect((await a.getAccount())?.assurance?.enrolled).toBe(false);
    expect(state.calls).not.toContain("getSession");
  });

  it("holds a session whose enrolment could not be read (Supabase Auth unreachable), and never lets it through", async () => {
    signIn({ sub: authUser, userError: true });
    expect(await a.getAccount()).toBeNull();
    expect((await a.getAssurance())?.assurance).toEqual({ state: "unknown" });
    await expect(a.requireAccount()).rejects.toThrow("REDIRECT:/admin/sign-in/two-step?unavailable=1");
    // An aal2 session is unaffected: the signed claim proves it.
    signIn({ sub: authUser, aal: "aal2", userError: true });
    expect(await a.getAccount()).not.toBeNull();
  });

  it("requires a platform admin to have a second step: held at enrolment without one, let in at aal2", async () => {
    const admin = await makeAccount("platform-admin", { platformAdmin: true, authUserId: undefined });
    const sub = await linkAuthUser(admin.id);
    signIn({ sub });
    expect(await a.getAccount()).toBeNull();
    expect((await a.getAssurance())?.assurance).toEqual({ state: "enrol", reason: "platform" });
    await expect(a.requirePlatformAdmin()).rejects.toThrow("REDIRECT:/admin/sign-in/two-step/set-up");
    signIn({ sub, aal: "aal2", factors: [factor] });
    expect((await a.requirePlatformAdmin()).id).toBe(admin.id);
  });

  it("holds an account whose second step was reset (a recovery code, or a platform admin) at enrolment whatever else is true", async () => {
    await db().execute(sql`update commerce.accounts set two_step_reenrol_at = now() where id = ${store.account.id}::uuid`);
    try {
      expect((await a.getAssurance())?.assurance).toEqual({ state: "enrol", reason: "reset" });
      expect(await a.getAccount()).toBeNull();
    } finally {
      await db().execute(sql`update commerce.accounts set two_step_reenrol_at = null where id = ${store.account.id}::uuid`);
    }
  });

  it("lifts the whole requirement with ADMIN_TWO_STEP=off and writes it down, once in twelve hours", async () => {
    signIn({ sub: authUser, factors: [factor] });
    process.env.ADMIN_TWO_STEP = "off";
    expect(await a.getAccount()).not.toBeNull();
    expect(await a.getAccount()).not.toBeNull();
    const rows = await db().execute<Row>(sql`select area from commerce.audit_log where account_id = ${store.account.id}::uuid and action = 'account.two_step_switch_off'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].area).toBe("account");
  });

  it("keeps the display mirror: set when an aal2 session is seen, cleared when an aal1 session shows no factor, never used for access", async () => {
    signIn({ sub: authUser, factors: [factor], aal: "aal2" });
    await a.getAccount();
    const [on] = await db().execute<Row>(sql`select two_step_since from commerce.accounts where id = ${store.account.id}::uuid`);
    expect(on.two_step_since).not.toBeNull();
    signIn({ sub: authUser, factors: [] });
    await a.getAccount();
    const [off] = await db().execute<Row>(sql`select two_step_since from commerce.accounts where id = ${store.account.id}::uuid`);
    expect(off.two_step_since).toBeNull();
    // A stale mirror that says "has two-step" does not hold an unenrolled account.
    await db().execute(sql`update commerce.accounts set two_step_since = now() where id = ${store.account.id}::uuid`);
    signIn({ sub: authUser, factors: [] });
    expect(await a.getAccount()).not.toBeNull();
  });
});

describe("getMembership() and the store's requirement", () => {
  it("returns the membership with its role, kind and no custom permissions for an owner", async () => {
    const member = await a.getMembership(store.slug);
    expect(member).toMatchObject({ role: "owner", kind: "staff", roleId: null, permissions: null, expiresAt: null });
    expect(member?.store.slug).toBe(store.slug);
    expect(await a.getMembership(other.slug)).toBeNull();
  });

  it("holds a member without a second step before the store that requires it, and no other store of theirs", async () => {
    await addMember(other.id, store.account.id, "admin");
    await db().execute(sql`update commerce.stores set require_two_step = true where id = ${store.id}::uuid`);
    try {
      expect(await a.getMembership(store.slug)).toBeNull();
      await expect(a.requireMember(store.slug)).rejects.toThrow("REDIRECT:/admin/sign-in/two-step/set-up");
      expect(await a.getMembership(other.slug)).not.toBeNull();
      // With the second step passed the store lets them in.
      signIn({ sub: authUser, factors: [factor], aal: "aal2" });
      expect(await a.getMembership(store.slug)).not.toBeNull();
    } finally {
      await db().execute(sql`update commerce.stores set require_two_step = false where id = ${store.id}::uuid`);
    }
  });

  it("reads the store's requirement from the database at the moment, not from the cached store", async () => {
    expect(await a.getMembership(store.slug)).not.toBeNull();
    await db().execute(sql`update commerce.stores set require_two_step = true where id = ${store.id}::uuid`);
    try {
      expect(await a.getMembership(store.slug)).toBeNull();
    } finally {
      await db().execute(sql`update commerce.stores set require_two_step = false where id = ${store.id}::uuid`);
    }
  });

  it("ignores a collaborator whose access has ended, even before the daily job marks it, and carries a custom role's keys", async () => {
    const agency = await makeAccount("agency");
    const sub = await linkAuthUser(agency.id);
    const [role] = await db().execute<Row>(sql`insert into commerce.store_roles (store_id, name, permissions) values (${store.id}::uuid, ${`Orders ${Date.now()}`}, array['orders:write', 'orders:read']) returning id`);
    await addMember(store.id, agency.id, "admin", { roleId: String(role.id), kind: "collaborator", expiresAt: new Date(Date.now() + 3_600_000) });
    signIn({ sub });
    const active = await a.getMembership(store.slug);
    expect(active).toMatchObject({ role: "admin", kind: "collaborator", roleName: expect.stringContaining("Orders"), permissions: ["orders:write", "orders:read"] });
    expect(active?.expiresAt).toBeInstanceOf(Date);
    await db().execute(sql`update commerce.store_members set expires_at = now() - interval '1 minute' where store_id = ${store.id}::uuid and account_id = ${agency.id}::uuid`);
    expect(await a.getMembership(store.slug)).toBeNull();
    await expect(a.requireMember(store.slug)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a disabled member and a closed store are not members", async () => {
    const gone = await makeAccount("gone");
    const sub = await linkAuthUser(gone.id);
    await addMember(store.id, gone.id, "admin");
    await db().execute(sql`update commerce.store_members set disabled_at = now() where store_id = ${store.id}::uuid and account_id = ${gone.id}::uuid`);
    signIn({ sub });
    expect(await a.getMembership(store.slug)).toBeNull();
  });
});

describe("audit() with its optional extras", () => {
  it("fills the area from the action's prefix and takes an explicit area, a target and changes", async () => {
    await a.audit(store.account.id, store.id, "discount.created", { code: "X" });
    await a.audit(store.account.id, store.id, "page.published_with_issues", { page: "p" }, { area: "website", target: { type: "page", id: "p1" }, changes: { title: { from: "a", to: "b" } } });
    const rows = await auditRows(store.id);
    const plain = rows.find((r) => r.action === "discount.created")!;
    expect(plain.area).toBe("marketing");
    expect(plain.target_type).toBeNull();
    const rich = rows.find((r) => r.action === "page.published_with_issues")!;
    expect(rich).toMatchObject({ area: "website", target_type: "page", target_id: "p1", changes: { title: { from: "a", to: "b" } } });
  });
});

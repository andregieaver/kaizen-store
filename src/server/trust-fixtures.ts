// Test support for the wave 1 trust lane's integration tests (legal pages, terms, staff security): stores with owners and members,
// and a stand-in for Supabase Auth's client. Not imported by the app.
import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import type { Account, Membership } from "./auth";
import { getStore } from "./stores";

type Row = Record<string, unknown>;

export const run = Date.now().toString(36);
let counter = 0;
export const unique = (prefix: string) => `${prefix}-${run}-${++counter}`;

/** A store made the way a real one is (an approved access request), with its owner's account; the owner has no Supabase Auth user until a test gives one. */
export async function makeStore(name: string): Promise<{ id: string; slug: string; account: Account }> {
  const slug = unique(name);
  const email = `${slug}@example.com`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Kari', ${name}) returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${name}, null) as id`);
  const [row] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${email}`);
  return { id: String(store.id), slug, account: { id: String(row.id), email: String(row.email), name: "Kari", platformAdmin: false } };
}

/** An account with no store (an agency's, a platform admin's). */
export async function makeAccount(label: string, options: { platformAdmin?: boolean; authUserId?: string } = {}): Promise<Account> {
  const email = `${unique(label)}@example.com`;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin, auth_user_id)
    values (${email}, ${label}, ${Boolean(options.platformAdmin)}, ${options.authUserId ?? null}::uuid) returning id, email, name, platform_admin
  `);
  return { id: String(row.id), email: String(row.email), name: String(row.name), platformAdmin: Boolean(row.platform_admin) };
}

export async function addMember(storeId: string, accountId: string, role: "owner" | "admin" = "admin", extra: { roleId?: string | null; kind?: "staff" | "collaborator"; expiresAt?: Date | null } = {}): Promise<void> {
  await db().execute(sql`
    insert into commerce.store_members (store_id, account_id, role, role_id, kind, expires_at)
    values (${storeId}::uuid, ${accountId}::uuid, ${role}, ${extra.roleId ?? null}::uuid, ${extra.kind ?? "staff"}, ${extra.expiresAt?.toISOString() ?? null}::timestamptz)
    on conflict (store_id, account_id) do update set role = excluded.role, role_id = excluded.role_id, kind = excluded.kind, expires_at = excluded.expires_at, disabled_at = null
  `);
}

export async function linkAuthUser(accountId: string): Promise<string> {
  const id = randomUUID();
  await db().execute(sql`update commerce.accounts set auth_user_id = ${id}::uuid where id = ${accountId}::uuid`);
  return id;
}

/** A membership as the server functions take it, read from the store as the app reads it. */
export async function membershipOf(slug: string, account: Account, role: "owner" | "admin" = "owner", extra: Partial<Membership> = {}): Promise<Membership> {
  const store = (await getStore(slug))!;
  return { account, store, role, ...extra };
}

export async function auditRows(storeId: string | null, action?: string): Promise<Row[]> {
  return db().execute<Row>(sql`
    select id, account_id, store_id, action, details, area, target_type, target_id, changes, created_at from commerce.audit_log
    where store_id is not distinct from ${storeId}::uuid ${action ? sql`and action = ${action}` : sql``} order by id
  `);
}

// ---------------------------------------------------------------------------
// Supabase Auth
// ---------------------------------------------------------------------------

export type FakeFactor = { id: string; status: "verified" | "unverified"; factor_type: "totp" };

/** What the stand-in Auth server holds for the signed-in session, and what its calls did. */
export type FakeAuthState = {
  /** The signed-in user (the account's `auth_user_id`), or null for nobody. */
  sub: string | null;
  aal: "aal1" | "aal2";
  /** The factors the Auth SERVER holds. */
  factors: FakeFactor[];
  /** What the session cookie's copy of the user claims: the person's to edit, never trusted. */
  cookieFactors?: FakeFactor[];
  /** `getUser()` fails (Supabase Auth unreachable). */
  userError?: boolean;
  /** The code the authenticator shows now. */
  validCode: string;
  calls: string[];
  /** Hold the next `verify` to fail with this message. */
  verifyFails?: boolean;
};

export function fakeAuthState(overrides: Partial<FakeAuthState> = {}): FakeAuthState {
  return { sub: null, aal: "aal1", factors: [], validCode: "123456", calls: [], ...overrides };
}

/** A stand-in for the server's Supabase client with the calls the second step makes. */
export function fakeSupabase(state: FakeAuthState) {
  const ok = <T,>(data: T) => ({ data, error: null });
  const fail = (message: string) => ({ data: null, error: { message } });
  return {
    auth: {
      async getClaims() {
        state.calls.push("getClaims");
        return state.sub ? ok({ claims: { sub: state.sub, aal: state.aal }, header: {}, signature: new Uint8Array() }) : fail("no session");
      },
      /** What the session cookie holds: the person can edit it, so nothing the gate decides may come from here. */
      async getSession() {
        state.calls.push("getSession");
        return ok({ session: state.sub ? { user: { id: state.sub, factors: state.cookieFactors ?? [] } } : null });
      },
      async getUser() {
        state.calls.push("getUser");
        if (state.userError) return fail("auth unreachable");
        // The cookie's copy may differ from the server's: the server's is what this returns.
        return state.sub ? ok({ user: { id: state.sub, factors: state.factors } }) : fail("no session");
      },
      mfa: {
        async enroll(params: { factorType: string; friendlyName?: string }) {
          state.calls.push("enroll");
          const factor: FakeFactor = { id: randomUUID(), status: "unverified", factor_type: "totp" };
          state.factors.push(factor);
          return ok({ id: factor.id, type: "totp", friendly_name: params.friendlyName, totp: { qr_code: "<svg></svg>", secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/Kaizen:test?secret=JBSWY3DPEHPK3PXP" } });
        },
        async challenge(params: { factorId: string }) {
          state.calls.push("challenge");
          return state.factors.some((f) => f.id === params.factorId) ? ok({ id: randomUUID(), type: "totp", expires_at: 0 }) : fail("factor not found");
        },
        async verify(params: { factorId: string; challengeId: string; code: string }) {
          state.calls.push("verify");
          if (state.verifyFails || params.code !== state.validCode) return fail("Invalid TOTP code entered");
          const factor = state.factors.find((f) => f.id === params.factorId);
          if (!factor) return fail("factor not found");
          factor.status = "verified";
          state.aal = "aal2";
          return ok({ access_token: "t", user: { id: state.sub } });
        },
        async unenroll(params: { factorId: string }) {
          state.calls.push("unenroll");
          const factor = state.factors.find((f) => f.id === params.factorId);
          if (!factor) return fail("factor not found");
          if (factor.status === "verified" && state.aal !== "aal2") return fail("AAL2 required to unenroll a verified factor");
          state.factors = state.factors.filter((f) => f.id !== params.factorId);
          return ok({ id: params.factorId });
        },
        async listFactors() {
          return ok({ all: state.factors, totp: state.factors.filter((f) => f.status === "verified") });
        },
      },
    },
  };
}

/** The admin API's stand-in: factors by user, deletions recorded. */
export function fakeAdmin(factorsByUser: Map<string, FakeFactor[]>, options: { failDelete?: boolean } = {}) {
  const deleted: { userId: string; id: string }[] = [];
  return {
    deleted,
    admin: {
      mfa: {
        async listFactors(params: { userId: string }) {
          return { data: { factors: factorsByUser.get(params.userId) ?? [] }, error: null };
        },
        async deleteFactor(params: { userId: string; id: string }) {
          if (options.failDelete) return { data: null, error: { message: "boom" } };
          deleted.push({ userId: params.userId, id: params.id });
          factorsByUser.set(params.userId, (factorsByUser.get(params.userId) ?? []).filter((f) => f.id !== params.id));
          return { data: { id: params.id }, error: null };
        },
      },
    },
  };
}

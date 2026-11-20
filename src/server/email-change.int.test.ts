import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { OutgoingEmail } from "./email";
import { addMember, auditRows, fakeAuthState, fakeSupabase, linkAuthUser, makeAccount, makeStore, unique } from "./trust-fixtures";

process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
const hoisted = vi.hoisted(() => ({ client: null as unknown, admin: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => hoisted.client }));
vi.mock("./supabase-admin", () => ({
  adminAuth: () => (hoisted.admin ? { ok: true, admin: hoisted.admin } : { ok: false, problem: "Not on this server." }),
}));

const ec = await import("./email-change");
const { sendEmail } = await import("./email");
const { listStaff } = await import("./settings");
const { listPlatformActivity } = await import("./activity");
const { pruneEmailChanges } = await import("./security-jobs");

type Row = Record<string, unknown>;

/**
 * A person's own name and email (D836), against the database: the name on the Team page's read and in the change log without its value; a
 * change of email asked by a fresh session, waiting as a hash with its link sent to the new address and a notice to the old, confirmed in one
 * step with Supabase Auth's admin API (a stand-in), refused when the link is wrong, used, run out or its address taken, rolled back when
 * Supabase refuses; and a platform admin's correction and link, in the platform's log. Supabase Auth is a stand-in, the database is real.
 */

type AuthCall = { id: string; attrs: Record<string, unknown> };
let authCalls: AuthCall[] = [];
/** Supabase Auth's admin API: records each change of a user's email; `fail` makes it refuse. */
const authAdmin = (fail?: { code?: string; message: string }) => ({
  async updateUserById(id: string, attrs: Record<string, unknown>) {
    authCalls.push({ id, attrs });
    return fail ? { data: { user: null }, error: fail } : { data: { user: { id } }, error: null };
  },
});

/** What was mailed, as the mailer was handed it (the token is in the link); each is also kept the real way. */
let mailed: OutgoingEmail[] = [];
const mail = async (message: OutgoingEmail) => {
  mailed.push(message);
  return sendEmail(message);
};
const tokenOf = (message: OutgoingEmail | undefined): string => {
  const found = /token=([A-Za-z0-9_-]{43})/.exec(message?.email.text ?? "");
  if (!found) throw new Error("no link in the email");
  return found[1];
};

/** A signed-in session for the account: fresh unless said, at `aal1` with no factor. */
function signIn(authUserId: string, options: { fresh?: boolean; aal?: "aal1" | "aal2"; factors?: boolean } = {}) {
  const now = Math.floor(Date.now() / 1000);
  hoisted.client = fakeSupabase(
    fakeAuthState({
      sub: authUserId,
      aal: options.aal ?? "aal1",
      amr: [{ method: "password", timestamp: options.fresh === false ? now - 3600 : now }],
      factors: options.factors ? [{ id: crypto.randomUUID(), status: "verified", factor_type: "totp" }] : [],
    }),
  );
}

const accountRow = async (id: string) =>
  (await db().execute<Row>(sql`select email, name from commerce.accounts where id = ${id}::uuid`))[0];
const changeRow = async (accountId: string) =>
  (await db().execute<Row>(sql`select * from commerce.account_email_changes where account_id = ${accountId}::uuid`))[0];
const kept = async (kind: string, to: string) =>
  db().execute<Row>(sql`select to_address, subject, text, html from commerce.email_messages where kind = ${kind} and to_address = ${to} order by created_at`);

let owner: Awaited<ReturnType<typeof makeStore>>;
let authUser: string;

beforeEach(async () => {
  owner = await makeStore("emailchange");
  authUser = await linkAuthUser(owner.account.id);
  signIn(authUser);
  hoisted.admin = authAdmin();
  authCalls = [];
  mailed = [];
});

afterAll(async () => {
  await closeDb();
});

describe("a person's own name", () => {
  it("is trimmed, saved, shown on the Team page's read and logged without its value", async () => {
    expect(await ec.changeOwnName(owner.account, "  Kari   Nordmann ")).toEqual({ ok: true, name: "Kari Nordmann" });
    expect((await accountRow(owner.account.id)).name).toBe("Kari Nordmann");
    const team = await listStaff(owner.id);
    expect(team.find((m) => m.accountId === owner.account.id)?.name).toBe("Kari Nordmann");
    const [platform] = (await auditRows(null, "account.name_changed")).filter((r) => r.target_id === owner.account.id);
    expect(platform).toMatchObject({ account_id: owner.account.id, area: "account", changes: { name: { changed: true } } });
    expect(JSON.stringify(platform.details)).not.toContain("Nordmann");
    // And in the store's own log, for its owner to see.
    expect((await auditRows(owner.id, "account.name_changed")).some((r) => r.target_id === owner.account.id)).toBe(true);
  });

  it("is never empty or too long, and the same name writes nothing", async () => {
    expect(await ec.changeOwnName(owner.account, "   ")).toEqual({ ok: false, problem: "empty" });
    expect(await ec.changeOwnName(owner.account, "x".repeat(121))).toEqual({ ok: false, problem: "long" });
    expect((await accountRow(owner.account.id)).name).toBe("Kari");
    await ec.changeOwnName(owner.account, "Kari");
    expect((await auditRows(null, "account.name_changed")).filter((r) => r.target_id === owner.account.id)).toHaveLength(0);
  });
});

describe("asking to change one's email", () => {
  it("needs a sign-in from the last ten minutes, and the second step where the account has one", async () => {
    signIn(authUser, { fresh: false });
    expect(await ec.requestEmailChange(owner.account, `${unique("new")}@example.com`, { mail })).toEqual({ ok: false, problem: "sign_in_again" });
    signIn(authUser, { factors: true });
    expect(await ec.requestEmailChange(owner.account, `${unique("new")}@example.com`, { mail })).toEqual({ ok: false, problem: "second_step" });
    signIn(authUser, { factors: true, aal: "aal2" });
    expect((await ec.requestEmailChange(owner.account, `${unique("new")}@example.com`, { mail })).ok).toBe(true);
  });

  it("keeps the change as a hash, sends the link to the new address with no token in the log, and tells the old address", async () => {
    const to = `${unique("New")}@Example.com`;
    const asked = await ec.requestEmailChange(owner.account, to, { mail });
    expect(asked).toEqual({ ok: true, email: to.toLowerCase() });
    const row = await changeRow(owner.account.id);
    expect(row).toMatchObject({ new_email: to.toLowerCase(), requested_by: owner.account.id, used_at: null });
    const link = mailed.find((m) => m.kind === "security.email_change_confirm");
    expect(link?.to).toBe(to.toLowerCase());
    const token = tokenOf(link);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.token_hash).not.toBe(token);
    const hours = (new Date(String(row.expires_at)).getTime() - new Date(String(row.created_at)).getTime()) / 3_600_000;
    expect(hours).toBeCloseTo(24, 3);
    // The log's copy of the link's email carries no token.
    const [logged] = await kept("security.email_change_confirm", to.toLowerCase());
    expect(String(logged.text)).not.toContain(token);
    expect(String(logged.html)).not.toContain(token);
    expect(String(logged.text)).toContain("[code]");
    // The old address is told, the new one half hidden.
    const [notice] = await kept("security.email_change_requested", owner.account.email);
    expect(String(notice.text)).toContain(`${to.toLowerCase().slice(0, 1)}•••@example.com`);
    expect(String(notice.text)).not.toContain(to.toLowerCase());
    const [entry] = (await auditRows(null, "account.email_change_requested")).filter((r) => r.target_id === owner.account.id);
    expect(JSON.stringify(entry)).not.toContain(to.toLowerCase());
    expect(JSON.stringify(entry)).not.toContain(token);
  });

  it("refuses what is not an address, the address it has, and any account's address, without saying whose", async () => {
    expect(await ec.requestEmailChange(owner.account, "not-an-address", { mail })).toEqual({ ok: false, problem: "invalid" });
    expect(await ec.requestEmailChange(owner.account, owner.account.email.toUpperCase(), { mail })).toEqual({ ok: false, problem: "same" });
    const other = await makeAccount("other");
    expect(await ec.requestEmailChange(owner.account, other.email.toUpperCase(), { mail })).toEqual({ ok: false, problem: "taken" });
    expect(await changeRow(owner.account.id)).toBeUndefined();
    expect(mailed).toHaveLength(0);
  });

  it("sends at most five links an hour for one account", async () => {
    for (let i = 0; i < 5; i++) expect((await ec.requestEmailChange(owner.account, `${unique("many")}@example.com`, { mail })).ok).toBe(true);
    expect(await ec.requestEmailChange(owner.account, `${unique("many")}@example.com`, { mail })).toEqual({ ok: false, problem: "too_many" });
  });

  it("replaces a waiting change with a new request, and its old link stops working", async () => {
    await ec.requestEmailChange(owner.account, `${unique("first")}@example.com`, { mail });
    const first = tokenOf(mailed.find((m) => m.kind === "security.email_change_confirm"));
    const second = `${unique("second")}@example.com`;
    await ec.requestEmailChange(owner.account, second, { mail });
    expect((await ec.emailChangeLink(first)).state).toBe("unknown");
    expect(await ec.confirmEmailChange(first, { mail })).toMatchObject({ ok: false, problem: "unknown" });
    expect((await ec.pendingEmailChange(owner.account.id))?.email).toBe(second);
  });

  it("cancels a waiting change: its link no longer works", async () => {
    await ec.requestEmailChange(owner.account, `${unique("cancel")}@example.com`, { mail });
    const token = tokenOf(mailed[0]);
    expect(await ec.cancelEmailChange(owner.account.id)).toBe(true);
    expect(await ec.cancelEmailChange(owner.account.id)).toBe(false);
    expect((await ec.emailChangeLink(token)).state).toBe("unknown");
  });
});

describe("opening the link", () => {
  async function asked(): Promise<{ token: string; to: string }> {
    const to = `${unique("moved")}@example.com`;
    const result = await ec.requestEmailChange(owner.account, to, { mail });
    if (!result.ok) throw new Error(result.problem);
    return { token: tokenOf(mailed.find((m) => m.kind === "security.email_change_confirm" && m.to === to)), to };
  }

  it("moves the account and Supabase Auth's email in one step, marks the link used and tells the old address", async () => {
    const { token, to } = await asked();
    // Reading the link changes nothing (a mail scanner that opens it).
    expect(await ec.emailChangeLink(token)).toEqual({ state: "valid", email: to, lang: "en" });
    expect((await accountRow(owner.account.id)).email).toBe(owner.account.email);

    expect(await ec.confirmEmailChange(token, { mail })).toEqual({ ok: true, email: to, lang: "en" });
    expect((await accountRow(owner.account.id)).email).toBe(to);
    expect(authCalls).toEqual([{ id: authUser, attrs: { email: to, email_confirm: true } }]);
    expect((await changeRow(owner.account.id)).used_at).not.toBeNull();
    const [notice] = await kept("security.email_change_changed", owner.account.email);
    expect(String(notice.text)).toContain(`${to.slice(0, 1)}•••@example.com`);
    const [entry] = (await auditRows(null, "account.email_changed")).filter((r) => r.target_id === owner.account.id);
    expect(entry).toMatchObject({ changes: { email: { changed: true } } });
    expect(JSON.stringify(entry)).not.toContain(to);

    // Once only.
    expect(await ec.confirmEmailChange(token, { mail })).toMatchObject({ ok: false, problem: "used" });
    expect(await ec.emailChangeLink(token)).toEqual({ state: "used", email: to, lang: "en" });
    expect(authCalls).toHaveLength(1);
  });

  it("changes nothing for a wrong token, a link that ran out, or an address another account took meanwhile", async () => {
    const { token, to } = await asked();
    expect(await ec.confirmEmailChange("x".repeat(43), { mail })).toMatchObject({ ok: false, problem: "unknown" });
    expect(await ec.confirmEmailChange("short", { mail })).toMatchObject({ ok: false, problem: "unknown", lang: null });
    expect(await ec.confirmEmailChange(token, { mail, now: new Date(Date.now() + 25 * 3_600_000) })).toMatchObject({ ok: false, problem: "expired" });
    expect(await ec.emailChangeLink(token, new Date(Date.now() + 25 * 3_600_000))).toMatchObject({ state: "expired" });
    await db().execute(sql`insert into commerce.accounts (email) values (${to.toUpperCase()})`);
    expect(await ec.confirmEmailChange(token, { mail })).toMatchObject({ ok: false, problem: "taken" });
    expect((await accountRow(owner.account.id)).email).toBe(owner.account.email);
    expect((await changeRow(owner.account.id)).used_at).toBeNull();
    expect(authCalls).toHaveLength(0);
  });

  it("rolls everything back when Supabase Auth refuses, and says why", async () => {
    const { token } = await asked();
    hoisted.admin = authAdmin({ message: "down" });
    expect(await ec.confirmEmailChange(token, { mail })).toEqual({ ok: false, problem: "failed", lang: "en" });
    expect((await accountRow(owner.account.id)).email).toBe(owner.account.email);
    expect((await changeRow(owner.account.id)).used_at).toBeNull();
    hoisted.admin = authAdmin({ code: "email_exists", message: "taken" });
    expect(await ec.confirmEmailChange(token, { mail })).toMatchObject({ ok: false, problem: "taken" });
    hoisted.admin = null;
    expect(await ec.confirmEmailChange(token, { mail })).toMatchObject({ ok: false, problem: "failed" });
    expect((await accountRow(owner.account.id)).email).toBe(owner.account.email);
    // Supabase back: the same link still works.
    hoisted.admin = authAdmin();
    expect((await ec.confirmEmailChange(token, { mail })).ok).toBe(true);
  });

  it("moves an account with no Supabase Auth user yet by its own row alone", async () => {
    const invited = await makeAccount("invited");
    await addMember(owner.id, invited.id);
    const admin = await makeAccount("platform", { platformAdmin: true });
    const to = `${unique("invited-new")}@example.com`;
    expect(await ec.sendEmailChangeFor(admin, invited.id, to, { mail, fresh: true })).toEqual({ ok: true, email: to });
    const token = tokenOf(mailed.find((m) => m.to === to));
    expect(await ec.confirmEmailChange(token, { mail })).toMatchObject({ ok: true, email: to });
    expect((await accountRow(invited.id)).email).toBe(to);
    expect(authCalls).toHaveLength(0);
  });

  it("moves the person's customer of Kaizena Flow's own store with them, its name too, while it still matches the account", async () => {
    const { houseCustomerOfAccount, syncHouseCustomers } = await import("./house-customers");
    await syncHouseCustomers();
    const house = await houseCustomerOfAccount(owner.account.id);
    expect(house).not.toBeNull();
    const customer = async () => (await db().execute<Row>(sql`select name, email from commerce.customers where id = ${house!.customerId}::uuid`))[0];
    await ec.changeOwnName(owner.account, "Kari Ny");
    expect((await customer()).name).toBe("Kari Ny");
    const { token, to } = await asked();
    await ec.confirmEmailChange(token, { mail });
    expect((await customer()).email).toBe(to);
    // What staff wrote by hand stays.
    await db().execute(sql`update commerce.customers set name = 'Written by staff' where id = ${house!.customerId}::uuid`);
    await ec.changeOwnName(owner.account, "Kari Igjen");
    expect((await customer()).name).toBe("Written by staff");
    await syncHouseCustomers();
    expect((await houseCustomerOfAccount(owner.account.id))?.customerId).toBe(house!.customerId);
  });

  it("is pruned a day after it was used or ran out", async () => {
    const { token } = await asked();
    await ec.confirmEmailChange(token, { mail });
    expect(await pruneEmailChanges(new Date(Date.now() + 2 * 86_400_000))).toBeGreaterThanOrEqual(1);
    expect(await changeRow(owner.account.id)).toBeUndefined();
  });
});

describe("a platform admin's correction (platform parity)", () => {
  it("corrects someone's name and sends a link for them, both in the platform's log, never setting the address", async () => {
    const admin = await makeAccount("admin", { platformAdmin: true });
    expect(await ec.correctName(admin, owner.account.id, "Kari Rettet")).toEqual({ ok: true, name: "Kari Rettet" });
    const to = `${unique("given")}@example.com`;
    expect(await ec.sendEmailChangeFor(admin, owner.account.id, to, { mail, fresh: true })).toEqual({ ok: true, email: to });
    expect((await accountRow(owner.account.id)).email).toBe(owner.account.email);
    expect(await changeRow(owner.account.id)).toMatchObject({ new_email: to, requested_by: admin.id });
    expect(String(mailed.find((m) => m.to === to)?.email.text)).toContain("Kaizena Flow admin asked, for you");
    const [notice] = await kept("security.email_change_requested", owner.account.email);
    expect(String(notice.text)).toContain("a Kaizena Flow admin asked");

    const log = await listPlatformActivity({ accountId: admin.id });
    const actions = log.entries.filter((e) => e.target?.id === owner.account.id).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["account.name_corrected", "account.email_change_sent"]));
    expect(JSON.stringify(log.entries)).not.toContain(to);
  });

  it("is an owner's of the platform for the address, after a fresh sign-in, and never for themselves", async () => {
    const admin = await makeAccount("admin2", { platformAdmin: true });
    const support = await makeAccount("support");
    const to = `${unique("given2")}@example.com`;
    expect(await ec.sendEmailChangeFor({ ...support, platformRole: "support" }, owner.account.id, to, { mail, fresh: true })).toEqual({ ok: false, problem: "not_found" });
    expect(await ec.sendEmailChangeFor(admin, owner.account.id, to, { mail, fresh: false })).toEqual({ ok: false, problem: "sign_in_again" });
    expect(await ec.sendEmailChangeFor(admin, admin.id, to, { mail, fresh: true })).toEqual({ ok: false, problem: "own" });
    expect(await changeRow(owner.account.id)).toBeUndefined();
  });
});

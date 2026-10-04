import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { TWO_STEP_LIMIT } from "@/lib/two-step";

import { addMember, auditRows, fakeAdmin, fakeAuthState, fakeSupabase, linkAuthUser, makeAccount, makeStore, membershipOf, type FakeFactor } from "./trust-fixtures";

process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

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
const hoisted = vi.hoisted(() => ({ client: null as unknown, admin: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => hoisted.client }));
vi.mock("./supabase-admin", () => ({
  adminAuth: () => (hoisted.admin ? { ok: true, admin: hoisted.admin } : { ok: false, problem: "Recovery is not available on this server. Ask a platform admin to reset your two-step." }),
}));

const t = await import("./two-step");
const rc = await import("./recovery-codes");

type Row = Record<string, unknown>;

/**
 * Two-step sign-in's server side (wave 1, 1f, docs/wave-1-trust.md 2.6): enrolling with recovery codes, the second step and its limit on
 * wrong codes, single-use recovery codes that take the factors away and force re-enrolment, a platform admin's reset, and a store's
 * requirement. Supabase Auth is a stand-in (its factors, its TOTP), the database is real.
 */

let state = fakeAuthState();
let owner: Awaited<ReturnType<typeof makeStore>>;
let authUser: string;
let admin: ReturnType<typeof fakeAdmin>;

const session = (overrides: Parameters<typeof fakeAuthState>[0] = {}) => {
  state = fakeAuthState({ sub: authUser, ...overrides });
  hoisted.client = fakeSupabase(state);
};
const serverFactors = new Map<string, FakeFactor[]>();
const withAdmin = (options: { failDelete?: boolean } = {}) => {
  admin = fakeAdmin(serverFactors, options);
  hoisted.admin = admin.admin;
};

// A store and its owner for every test: the activity log cannot be cleared, so each test starts with a person nothing has happened to.
beforeEach(async () => {
  owner = await makeStore("twostep");
  authUser = await linkAuthUser(owner.account.id);
  session();
  withAdmin();
  serverFactors.clear();
});

afterAll(async () => {
  await closeDb();
});

const account = () => ({ ...owner.account, assurance: undefined });
const failures = async () => (await db().execute<Row>(sql`select 1 from commerce.audit_log where account_id = ${owner.account.id}::uuid and action = 'account.two_step_failed' and store_id is null`)).length;
const emails = async (kind: string) => db().execute<Row>(sql`select to_address, subject, html from commerce.email_messages where kind = ${kind} and to_address = ${owner.account.email}`);

/** Enrols the account for real through the module, as the page does, and returns the recovery codes. */
async function enrol(): Promise<string[]> {
  const started = await t.startEnrolment();
  if (!started.ok) throw new Error(started.problem);
  const finished = await t.finishEnrolment(account(), started.factorId, "123456");
  if (!finished.ok) throw new Error(finished.problem);
  serverFactors.set(authUser, state.factors);
  return finished.codes;
}

describe("enrolling", () => {
  it("starts with a QR code and a secret to type by hand, and refuses an account that already has a factor", async () => {
    const started = await t.startEnrolment();
    expect(started).toMatchObject({ ok: true, qrCode: expect.stringContaining("<svg"), secret: expect.any(String), uri: expect.stringContaining("otpauth://") });
    session({ factors: [{ id: "f1", status: "verified", factor_type: "totp" }] });
    expect(await t.startEnrolment()).toEqual({ ok: false, problem: "Two-step sign-in is already on for your account." });
  });

  it("removes a half-finished attempt before starting a new one", async () => {
    await t.startEnrolment();
    await t.startEnrolment();
    expect(state.factors.filter((f) => f.status === "unverified")).toHaveLength(1);
  });

  it("is refused where the server could not make recovery codes: a person is never left without a way back", async () => {
    const key = process.env.SETTINGS_ENCRYPTION_KEY;
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    try {
      expect(await t.startEnrolment()).toMatchObject({ ok: false, problem: expect.stringContaining("recovery codes") });
    } finally {
      process.env.SETTINGS_ENCRYPTION_KEY = key;
    }
  });

  it("finishes with the first right code: ten recovery codes shown once, only their hashes kept, the mirror set, the events written", async () => {
    const started = await t.startEnrolment();
    if (!started.ok) throw new Error("start");
    const finished = await t.finishEnrolment(account(), started.factorId, "123 456");
    expect(finished.ok).toBe(true);
    if (!finished.ok) return;
    expect(finished.codes).toHaveLength(10);
    expect(new Set(finished.codes).size).toBe(10);
    expect(finished.codes.every((c) => /^[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(c))).toBe(true);
    // Nothing readable is stored.
    const stored = await db().execute<Row>(sql`select code_hash from commerce.account_recovery_codes where account_id = ${owner.account.id}::uuid`);
    expect(stored).toHaveLength(10);
    for (const row of stored) {
      expect(String(row.code_hash)).toMatch(/^[0-9a-f]{64}$/);
      for (const code of finished.codes) expect(String(row.code_hash)).not.toContain(code.replace("-", "").toLowerCase());
    }
    const [row] = await db().execute<Row>(sql`select two_step_since, two_step_reenrol_at from commerce.accounts where id = ${owner.account.id}::uuid`);
    expect(row.two_step_since).not.toBeNull();
    expect(row.two_step_reenrol_at).toBeNull();
    // The platform's row (store null) and the owner's store row (area staff) for the enrolment.
    const platform = (await auditRows(null, "account.two_step_enrolled")).filter((r) => r.account_id === owner.account.id);
    expect(platform).toHaveLength(1);
    expect(platform[0].area).toBe("account");
    const perStore = await auditRows(owner.id, "account.two_step_enrolled");
    expect(perStore).toHaveLength(1);
    expect(perStore[0].area).toBe("staff");
    expect((await auditRows(null, "account.recovery_codes_generated")).filter((r) => r.account_id === owner.account.id)).toHaveLength(1);
    // The codes are not in any audit row.
    const everything = JSON.stringify(await db().execute(sql`select details, changes from commerce.audit_log where account_id = ${owner.account.id}::uuid`));
    for (const code of finished.codes) expect(everything).not.toContain(code);
  });

  it("counts a wrong code and pauses the account after five in fifteen minutes, without asking Supabase while paused", async () => {
    const started = await t.startEnrolment();
    if (!started.ok) throw new Error("start");
    let last: Awaited<ReturnType<typeof t.finishEnrolment>> | null = null;
    for (let i = 0; i < TWO_STEP_LIMIT.attempts; i++) last = await t.finishEnrolment(account(), started.factorId, "000000");
    expect(last).toMatchObject({ ok: false, locked: true, problem: expect.stringContaining("Too many attempts") });
    expect(await failures()).toBe(5);
    const before = state.calls.filter((c) => c === "verify").length;
    expect(await t.finishEnrolment(account(), started.factorId, "123456")).toMatchObject({ ok: false, locked: true });
    expect(state.calls.filter((c) => c === "verify").length).toBe(before);
    expect(await failures()).toBe(5);
  });

  it("refuses a code that is not six digits without counting it, and a factor that is not the person's", async () => {
    const started = await t.startEnrolment();
    if (!started.ok) throw new Error("start");
    expect(await t.finishEnrolment(account(), started.factorId, "12ab")).toMatchObject({ ok: false, problem: "Type the six digits from your authenticator app." });
    expect(await t.finishEnrolment(account(), "22222222-2222-4222-8222-222222222222", "123456")).toMatchObject({ ok: false, problem: expect.stringContaining("expired") });
    expect(await failures()).toBe(0);
  });
});

describe("the second step at sign-in", () => {
  it("passes with the right code and writes it down for the platform only", async () => {
    await enrol();
    session({ factors: state.factors.length ? state.factors : [], aal: "aal1" });
    state.factors = serverFactors.get(authUser)!;
    expect(await t.passSecondStep(account(), "123456")).toEqual({ ok: true });
    expect((await auditRows(null, "account.two_step_passed")).filter((r) => r.account_id === owner.account.id)).toHaveLength(1);
    expect(await auditRows(owner.id, "account.two_step_passed")).toHaveLength(0);
  });

  it("fails on a wrong code, counts it, and tells the last tries", async () => {
    await enrol();
    state.factors = serverFactors.get(authUser)!;
    state.aal = "aal1";
    const first = await t.passSecondStep(account(), "000000");
    expect(first).toMatchObject({ ok: false, problem: expect.stringContaining("did not work") });
    expect(await failures()).toBe(1);
    for (let i = 0; i < 2; i++) await t.passSecondStep(account(), "000000");
    expect(await t.passSecondStep(account(), "000000")).toMatchObject({ ok: false, problem: expect.stringContaining("One try left") });
  });

  it("pauses for fifteen minutes after the fifth wrong code and lets the account try again after them (a fixed clock)", async () => {
    await enrol();
    state.factors = serverFactors.get(authUser)!;
    state.aal = "aal1";
    const start = new Date();
    for (let i = 0; i < 5; i++) await t.passSecondStep(account(), "000000", start);
    const paused = await t.passSecondStep(account(), "123456", new Date(start.getTime() + 60_000));
    expect(paused).toMatchObject({ ok: false, locked: true });
    expect(state.aal).toBe("aal1");
    const later = new Date(Date.now() + 16 * 60_000);
    // The failures are older than the window by then.
    expect(await t.passSecondStep(account(), "123456", later)).toEqual({ ok: true });
  });

  it("is refused where the Auth server cannot be asked", async () => {
    session({ userError: true });
    expect(await t.passSecondStep(account(), "123456")).toMatchObject({ ok: false, problem: "We could not check your two-step status. Try again." });
  });
});

describe("recovery codes", () => {
  it("work once: the factors are removed, the other codes revoked, re-enrolment forced, the person emailed and everything logged", async () => {
    const codes = await enrol();
    state.aal = "aal1";
    const result = await t.useRecoveryCode(account(), codes[3].toLowerCase().replace("-", " "));
    expect(result).toEqual({ ok: true });
    expect(admin.deleted).toHaveLength(1);
    expect(serverFactors.get(authUser)).toEqual([]);
    const [row] = await db().execute<Row>(sql`select two_step_since, two_step_reenrol_at from commerce.accounts where id = ${owner.account.id}::uuid`);
    expect(row.two_step_since).toBeNull();
    expect(row.two_step_reenrol_at).not.toBeNull();
    expect(await rc.recoveryCodesLeft(owner.account.id)).toBe(0);
    expect(await t.useRecoveryCode(account(), codes[3])).toMatchObject({ ok: false, problem: expect.stringContaining("did not work") });
    expect(await t.useRecoveryCode(account(), codes[4])).toMatchObject({ ok: false });
    expect((await auditRows(null, "account.recovery_code_used")).filter((r) => r.account_id === owner.account.id)).toHaveLength(1);
    expect(await auditRows(owner.id, "account.recovery_code_used")).toHaveLength(1);
    const mail = await emails("security.recovery_code_used");
    expect(mail).toHaveLength(1);
    expect(String(mail[0].subject)).toBe("A recovery code was used on your account");
    // The email carries no code.
    for (const code of codes) expect(String(mail[0].html)).not.toContain(code);
  });

  it("leaves the code unspent when the server cannot remove factors (no secret key)", async () => {
    const codes = await enrol();
    hoisted.admin = null;
    const result = await t.useRecoveryCode(account(), codes[0]);
    expect(result).toEqual({ ok: false, problem: "Recovery is not available on this server. Ask a platform admin to reset your two-step." });
    expect(await rc.recoveryCodesLeft(owner.account.id)).toBe(10);
    expect(await rc.recoveryCodeValid(owner.account.id, codes[0])).toBe(true);
  });

  it("spends the code but says so when a factor could not be removed, and the account is still marked to re-enrol", async () => {
    const codes = await enrol();
    withAdmin({ failDelete: true });
    const result = await t.useRecoveryCode(account(), codes[0]);
    expect(result).toMatchObject({ ok: false, problem: expect.stringContaining("could not be removed") });
    expect(await rc.recoveryCodeValid(owner.account.id, codes[0])).toBe(false);
    const [row] = await db().execute<Row>(sql`select two_step_reenrol_at from commerce.accounts where id = ${owner.account.id}::uuid`);
    expect(row.two_step_reenrol_at).not.toBeNull();
  });

  it("two requests racing for one code cannot both win it", async () => {
    const codes = await enrol();
    const claims = await Promise.all([rc.claimRecoveryCode(owner.account.id, codes[1]), rc.claimRecoveryCode(owner.account.id, codes[1]), rc.claimRecoveryCode(owner.account.id, codes[1])]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("counts a wrong code like a wrong second step, and pauses at five", async () => {
    await enrol();
    let last: Awaited<ReturnType<typeof t.useRecoveryCode>> | null = null;
    for (let i = 0; i < 5; i++) last = await t.useRecoveryCode(account(), "ABCDE-FGHJK");
    expect(last).toMatchObject({ ok: false, locked: true });
    expect(await failures()).toBe(5);
  });

  it("a new set revokes the old: a revoked code no longer works", async () => {
    const codes = await enrol();
    session({ aal: "aal2", factors: serverFactors.get(authUser)! });
    const fresh = await t.regenerateRecoveryCodes(account());
    expect(fresh.ok).toBe(true);
    expect(await rc.recoveryCodeValid(owner.account.id, codes[0])).toBe(false);
    if (fresh.ok) expect(await rc.recoveryCodeValid(owner.account.id, fresh.codes[0])).toBe(true);
    expect(await rc.recoveryCodesLeft(owner.account.id)).toBe(10);
  });

  it("only an aal2 session can make a new set or switch two-step off", async () => {
    await enrol();
    session({ aal: "aal1", factors: serverFactors.get(authUser)! });
    expect(await t.regenerateRecoveryCodes(account())).toMatchObject({ ok: false, problem: expect.stringContaining("Confirm your second step") });
    expect(await t.removeSecondStep(account())).toMatchObject({ ok: false });
  });
});

describe("switching two-step off", () => {
  it("removes the factor, revokes the codes, clears the mirror, writes it down and emails the person", async () => {
    await enrol();
    session({ aal: "aal2", factors: serverFactors.get(authUser)! });
    expect(await t.removeSecondStep(account())).toEqual({ ok: true });
    expect(state.factors).toEqual([]);
    expect(await rc.recoveryCodesLeft(owner.account.id)).toBe(0);
    const [row] = await db().execute<Row>(sql`select two_step_since from commerce.accounts where id = ${owner.account.id}::uuid`);
    expect(row.two_step_since).toBeNull();
    expect((await auditRows(null, "account.two_step_removed")).filter((r) => r.account_id === owner.account.id)).toHaveLength(1);
    expect(await auditRows(owner.id, "account.two_step_removed")).toHaveLength(1);
    expect(await emails("security.two_step_removed")).toHaveLength(1);
  });
});

describe("a platform admin's reset", () => {
  it("removes the person's factors, revokes their codes, holds them at enrolment, and is logged with who did it and emailed", async () => {
    const codes = await enrol();
    const platformAdmin = await makeAccount("reset-admin", { platformAdmin: true });
    const result = await t.resetTwoStep(platformAdmin, owner.account.id);
    expect(result).toEqual({ ok: true, removed: 1 });
    expect(admin.deleted[0].userId).toBe(authUser);
    expect(await rc.recoveryCodeValid(owner.account.id, codes[0])).toBe(false);
    const [row] = await db().execute<Row>(sql`select two_step_since, two_step_reenrol_at from commerce.accounts where id = ${owner.account.id}::uuid`);
    expect(row.two_step_since).toBeNull();
    expect(row.two_step_reenrol_at).not.toBeNull();
    const logged = (await auditRows(null, "account.two_step_reset")).filter((r) => r.target_id === owner.account.id);
    expect(logged).toHaveLength(1);
    expect(logged[0].account_id).toBe(platformAdmin.id);
    expect(logged[0].details).toMatchObject({ by: platformAdmin.email });
    const mine = (await auditRows(owner.id, "account.two_step_reset")).filter((r) => r.target_id === owner.account.id);
    expect(mine).toHaveLength(1);
    expect(await emails("security.two_step_reset")).toHaveLength(1);
  });

  it("is for platform admins only, never for oneself, and needs the secret key", async () => {
    const notAdmin = await makeAccount("not-admin");
    expect(await t.resetTwoStep(notAdmin, owner.account.id)).toMatchObject({ ok: false, problem: "You do not have access to this." });
    const platformAdmin = await makeAccount("self-admin", { platformAdmin: true });
    expect(await t.resetTwoStep(platformAdmin, platformAdmin.id)).toMatchObject({ ok: false, problem: expect.stringContaining("your own two-step") });
    hoisted.admin = null;
    expect(await t.resetTwoStep(platformAdmin, owner.account.id)).toMatchObject({ ok: false, problem: expect.stringContaining("Recovery is not available") });
  });
});

describe("a store's requirement", () => {
  it("can be switched on only by an owner who has passed their own second step, and off by any owner", async () => {
    const member = await membershipOf(owner.slug, account(), "owner");
    session({ aal: "aal1" });
    expect(await t.setTwoStepRequirement(member, true)).toMatchObject({ ok: false, problem: expect.stringContaining("lock yourself out") });
    session({ aal: "aal2", factors: [{ id: "f", status: "verified", factor_type: "totp" }] });
    expect(await t.setTwoStepRequirement(member, true)).toEqual({ ok: true });
    const [on] = await db().execute<Row>(sql`select require_two_step from commerce.stores where id = ${owner.id}::uuid`);
    expect(on.require_two_step).toBe(true);
    const log = await auditRows(owner.id, "store.two_step_required");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ area: "staff", changes: { requireTwoStep: { from: false, to: true } } });
    session({ aal: "aal1" });
    expect(await t.setTwoStepRequirement(member, false)).toEqual({ ok: true });
    expect(await auditRows(owner.id, "store.two_step_optional")).toHaveLength(1);
    // Nothing changes, nothing is written.
    expect(await t.setTwoStepRequirement(member, false)).toEqual({ ok: true });
    expect(await auditRows(owner.id, "store.two_step_optional")).toHaveLength(1);
  });

  it("is refused to an admin", async () => {
    const admin = await makeAccount("admin-only");
    await addMember(owner.id, admin.id, "admin");
    const member = await membershipOf(owner.slug, admin, "admin");
    session({ aal: "aal2" });
    expect(await t.setTwoStepRequirement(member, true)).toEqual({ ok: false, problem: "You do not have access to this." });
  });

  it("lists the members and whether each is seen to have a second step", async () => {
    await db().execute(sql`update commerce.accounts set two_step_since = now() where id = ${owner.account.id}::uuid`);
    await addMember(owner.id, (await makeAccount("no-second-step")).id, "admin");
    const members = await t.twoStepMembers(owner.id);
    expect(members.find((m) => m.accountId === owner.account.id)?.hasTwoStep).toBe(true);
    expect(members.some((m) => m.hasTwoStep === false)).toBe(true);
  });
});

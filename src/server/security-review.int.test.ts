import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { ROLE_TEMPLATES } from "@/lib/permissions";

import { addMember, fakeAuthState, fakeSupabase, linkAuthUser, makeAccount, makeStore } from "./trust-fixtures";

process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); }, notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
const hoisted = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => hoisted.client }));

vi.mock("./supabase-admin", () => ({ adminAuth: () => ({ ok: true, admin: { mfa: { listFactors: async () => ({ data: { factors: [] }, error: null }), deleteFactor: async () => ({ error: null }) } } }) }));
const { controlCenter } = await import("./control-center");
const t = await import("./two-step");
const roles = await import("./store-roles");

type Row = Record<string, unknown>;

afterAll(async () => {
  await closeDb();
});

describe("security review (adversarial lens)", () => {
  it("control center and a store's home show sales and the latest orders (with customer names) to a member whose role grants no orders access, and to a collaborator whose time has run out", async () => {
    const victim = await makeStore("review-victim");
    await db().execute(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor,
        tax_minor, total_minor, billing_address, shipping_address, placed_at)
      values (${victim.id}::uuid, ${`RV-${Date.now()}`}, 'NO', 'NOK', 'nb-NO', 'shopper@example.com', 'paid', 99900, 0, 0, 0, 99900, '{}'::jsonb, ${JSON.stringify({ name: "Secret Shopper" })}::jsonb, now() - interval '1 day')
    `);
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
      select ${victim.id}::uuid, id, 'stripe', ${`pi_rv_${Date.now()}`}, 'acct_rv', 99900, 'NOK', 'captured'::commerce.payment_status from commerce.orders where store_id = ${victim.id}::uuid
    `);

    // An agency's account with its own store, invited to the victim's store with the Content role (website only), and expired yesterday.
    const agency = await makeStore("review-agency");
    await roles.ensureStoreRoles(victim.id);
    const [content] = await db().execute<Row>(sql`select id from commerce.store_roles where store_id = ${victim.id}::uuid and template = 'content'`);
    expect(ROLE_TEMPLATES.content.permissions).not.toContain("orders:read");
    await addMember(victim.id, agency.account.id, "admin", { roleId: String(content.id), kind: "collaborator", expiresAt: new Date(Date.now() - 24 * 3600 * 1000) });

    // The daily job has not run yet (or, for a live collaborator with a role that lacks orders, never will).
    const center = await controlCenter(agency.account);
    const seen = center.stores.find((s) => s.slug === victim.slug);
    // Expected: not visible at all (access ended). Actual: the store's figures and its latest order are returned.
    expect(seen, "an expired collaborator is still given the victim store's figures").toBeUndefined();
    expect(center.latest.some((o) => o.name === "Secret Shopper")).toBe(false);
  });

  it("a collaborator whose time has run out is not offered the store in the lists of stores, the sign-in check or the people lists, and a member whose role grants no orders sees none of its figures", async () => {
    const { listStores, signInAccount } = await import("./auth");
    const { listPeople } = await import("./work-choices");
    const victim = await makeStore("review-victim-2");
    const agency = await makeAccount("review-agency-2");
    await roles.ensureStoreRoles(victim.id);
    const [content] = await db().execute<Row>(sql`select id from commerce.store_roles where store_id = ${victim.id}::uuid and template = 'content'`);
    await addMember(victim.id, agency.id, "admin", { roleId: String(content.id), kind: "collaborator", expiresAt: new Date(Date.now() - 3600_000) });
    expect((await listStores(agency)).map((s) => s.slug)).not.toContain(victim.slug);
    expect(await signInAccount(agency.email)).toBeNull();
    expect((await listPeople(victim.id)).map((p) => p.id)).not.toContain(agency.id);

    // Still live, with the Content role: the store is listed, but sales, orders waiting and the latest orders are not counted for it.
    await db().execute(sql`update commerce.store_members set expires_at = now() + interval '1 day' where store_id = ${victim.id}::uuid and account_id = ${agency.id}::uuid`);
    expect((await listStores(agency)).map((s) => s.slug)).toContain(victim.slug);
    const live = (await controlCenter(agency)).stores.find((s) => s.slug === victim.slug);
    expect(live?.hides).toEqual(expect.arrayContaining(["sales"]));
    expect(live?.sales).toEqual([]);
    expect(live?.toSend).toBe(0);
  });

  it("the second step's limit on wrong codes is checked before the attempts are written, so parallel guesses all pass the check", async () => {
    const owner = await makeStore("review-race");
    const authUser = await linkAuthUser(owner.account.id);
    const state = fakeAuthState({ sub: authUser, aal: "aal1", factors: [{ id: "f1", status: "verified", factor_type: "totp" }] });
    hoisted.client = fakeSupabase(state);
    const account = { ...owner.account };
    const guesses = Array.from({ length: 40 }, (_, i) => String(100000 + i));
    await Promise.all(guesses.map((code) => t.passSecondStep(account, code)));
    const verifies = state.calls.filter((c) => c === "verify").length;
    // The limit is five wrong codes per 15 minutes (TWO_STEP_LIMIT.attempts).
    expect(verifies, "verify calls made by 40 parallel guesses").toBeLessThanOrEqual(5);
  });

  it("a right code gives its try back, and a second step the Auth server could not check is not held against the person", async () => {
    const owner = await makeStore("review-clear");
    const authUser = await linkAuthUser(owner.account.id);
    const state = fakeAuthState({ sub: authUser, aal: "aal1", factors: [{ id: "f1", status: "verified", factor_type: "totp" }] });
    hoisted.client = fakeSupabase(state);
    const account = { ...owner.account };
    // Ten right codes in a row: none of them counts against the five.
    for (let i = 0; i < 10; i++) expect(await t.passSecondStep(account, "123456")).toEqual({ ok: true });
    // The Auth server cannot be reached for the challenge: the try is cleared, five of those do not pause the account either.
    const down = { ...state, factors: [{ id: "gone", status: "verified" as const, factor_type: "totp" as const }] };
    const real = hoisted.client;
    hoisted.client = { ...(fakeSupabase(down) as object), auth: { ...(fakeSupabase(down) as { auth: object }).auth, mfa: { ...(fakeSupabase(down) as { auth: { mfa: object } }).auth.mfa, challenge: async () => ({ data: null, error: { message: "unreachable" } }) } } };
    for (let i = 0; i < 8; i++) {
      const answer = await t.passSecondStep(account, "123456");
      expect(answer.ok).toBe(false);
      expect("locked" in answer && answer.locked).toBeFalsy();
    }
    hoisted.client = real;
    expect(await t.passSecondStep(account, "123456")).toEqual({ ok: true });
    // Five wrong ones do pause it, and the sixth is refused without asking the Auth server.
    for (let i = 0; i < 5; i++) expect(await t.passSecondStep(account, "000000")).toMatchObject({ ok: false });
    const before = state.calls.filter((c) => c === "verify").length;
    expect(await t.passSecondStep(account, "123456")).toMatchObject({ ok: false, locked: true });
    expect(state.calls.filter((c) => c === "verify").length).toBe(before);
  });

  it("parallel wrong recovery codes are limited the same way, and a pause is not extended by the refused ones", async () => {
    const owner = await makeStore("review-recovery-race");
    await linkAuthUser(owner.account.id);
    const account = { ...owner.account };
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => t.useRecoveryCode(account, `ABCDE-${String(10000 + i).slice(0, 5).replace(/[01]/g, "2")}`)));
    // Whatever the mix of answers, no more than five tries were taken.
    const [{ n }] = await db().execute<{ n: number }>(sql`select count(*)::int as n from commerce.audit_log where account_id = ${owner.account.id}::uuid and store_id is null and action = 'account.two_step_attempt'`);
    expect(n).toBeLessThanOrEqual(5);
    expect(results.filter((r) => !r.ok && r.locked).length).toBeGreaterThanOrEqual(25);
  });
});

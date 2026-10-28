import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

const signup = await import("./self-signup");
const { listAccessRequests } = await import("./platform");
const { trialEndFor } = await import("./billing");

/**
 * Self-serve sign-up (D359) against a real database: a sign-up while the switch is on emails a link and makes nothing; the press on the
 * link's page makes the account and the store through the approval's own path, private, with a trial of 14 days, audited; a link is good
 * once and not after its day; the limits per address and network hold; off, a confirmed request waits for a platform admin; requests never
 * confirmed go a week after their link ended.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let admin: { id: string; email: string; name: string; platformAdmin: boolean };

async function linkSentTo(email: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    select text, kind from commerce.email_messages where to_address = ${email} and kind = 'platform.access_confirm' order by created_at desc limit 1
  `);
  const token = /\/sign-up\/confirm\/([A-Za-z0-9_-]{43})/.exec(String(row?.text ?? ""))?.[1];
  if (!token) throw new Error("no link sent");
  return token;
}
const requestOf = async (email: string) =>
  (await db().execute<Row>(sql`select * from commerce.access_requests where lower(email) = lower(${email}) order by created_at desc limit 1`))[0];
const input = (email: string, storeName = `Shop ${run}`) => ({ name: "Sam", email, storeName, message: "", lang: "en" as const });

beforeAll(async () => {
  const [a] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`signup-admin-${run}@example.com`}, 'Platform', true) returning id, email
  `);
  admin = { id: String(a.id), email: String(a.email), name: "Platform", platformAdmin: true };
  await signup.setSelfServe(admin, true);
});

afterEach(async () => {
  await signup.setSelfServe(admin, true);
});

afterAll(async () => {
  await signup.setSelfServe(admin, false);
  await closeDb();
});

describe("self-serve sign-up (D359)", () => {
  it("emails a link and makes nothing until the press, then makes the store with a trial, once", async () => {
    const email = `sam-${run}@example.com`;
    await signup.startSelfSignup(input(email), `10.1.0.1-${run}`);
    const request = await requestOf(email);
    expect(request).toMatchObject({ status: "pending", self_serve: true, confirmed_at: null });
    expect(String(request.confirm_hash)).toMatch(/^[0-9a-f]{64}$/);
    // Not on the admin's list while unconfirmed, and no "received" email.
    expect((await listAccessRequests()).some((r) => r.email === email)).toBe(false);
    expect(await signup.unconfirmedCount()).toBeGreaterThan(0);
    const [{ n: received }] = await db().execute<Row>(sql`select count(*)::int as n from commerce.email_messages where to_address = ${email} and kind = 'platform.access_received'`);
    expect(received).toBe(0);

    const token = await linkSentTo(email);
    expect(await signup.confirmationOf(token)).toEqual({ storeName: `Shop ${run}`, lang: "en" });
    expect(await signup.confirmationOf("x".repeat(43))).toBeNull();

    const done = await signup.confirmSelfSignup(token);
    expect(done).toEqual({ ok: true, storeName: `Shop ${run}`, password: false });
    const after = await requestOf(email);
    expect(after).toMatchObject({ status: "approved", confirm_hash: null, decided_by: null });
    const storeId = String(after.store_id);
    // Private until opened, as every new store (D339); the test databases start stores public, so it is held to the column's default.
    const [store] = await db().execute<Row>(sql`
      select s.private_mode = (select column_default::boolean from information_schema.columns
                               where table_schema = 'commerce' and table_name = 'stores' and column_name = 'private_mode') as as_new
      from commerce.stores s where s.id = ${storeId}::uuid
    `);
    expect(store.as_new).toBe(true);
    const [trial] = await db().execute<Row>(sql`select trial_ends_at > now() + interval '13 days' as long from commerce.store_billing where store_id = ${storeId}::uuid`);
    expect(trial.long).toBe(true);
    expect(await trialEndFor(storeId)).toBeGreaterThan(Date.now() / 1000);
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action = 'store.self_signup'`);
    expect(audited.n).toBe(1);

    // The link is good once.
    expect(await signup.confirmSelfSignup(token)).toEqual({ ok: false, problem: "unknown" });
    expect(await signup.confirmationOf(token)).toBeNull();
  });

  it("sets a password chosen at sign-up after the store is made, and refuses a weak one before the link is used (D369)", async () => {
    const email = `pw-${run}@example.com`;
    await signup.startSelfSignup(input(email, `Pw ${run}`), null);
    const token = await linkSentTo(email);
    const set: { email: string; password: string }[] = [];
    const setPassword = async (who: string, password: string) => {
      set.push({ email: who, password });
      return true;
    };
    // Too short, or the address itself: refused, and the link still works.
    expect(await signup.confirmSelfSignup(token, { password: "short", setPassword })).toEqual({ ok: false, problem: "password" });
    expect(await signup.confirmSelfSignup(token, { password: email, setPassword })).toEqual({ ok: false, problem: "password" });
    expect(await signup.confirmationOf(token)).not.toBeNull();
    expect(set).toEqual([]);
    const strong = "lantern orbit maple 42";
    expect(await signup.confirmSelfSignup(token, { password: strong, setPassword })).toEqual({ ok: true, storeName: `Pw ${run}`, password: true });
    expect(set).toEqual([{ email, password: strong }]);
    // A password that could not be set leaves the emailed link: the store is still made.
    const other = `pw2-${run}@example.com`;
    await signup.startSelfSignup(input(other, `Pw2 ${run}`), null);
    expect(await signup.confirmSelfSignup(await linkSentTo(other), { password: strong, setPassword: async () => false })).toEqual({ ok: true, storeName: `Pw2 ${run}`, password: false });
  });

  it("gives a taken store name a free address", async () => {
    const name = `Twin ${run}`;
    const first = await signup.freeSlug(name);
    const email = `twin-${run}@example.com`;
    await signup.startSelfSignup(input(email, name), null);
    expect(await signup.confirmSelfSignup(await linkSentTo(email))).toMatchObject({ ok: true });
    const second = await signup.freeSlug(name);
    expect(second).not.toBe(first);
    expect(second.startsWith(first.slice(0, 20))).toBe(true);
  });

  it("does not make a store from a link past its day", async () => {
    const email = `late-${run}@example.com`;
    await signup.startSelfSignup(input(email), null);
    const token = await linkSentTo(email);
    await db().execute(sql`update commerce.access_requests set confirm_expires_at = now() - interval '1 minute' where lower(email) = lower(${email})`);
    expect(await signup.confirmSelfSignup(token)).toEqual({ ok: false, problem: "unknown" });
    // A week after the link ended, the request goes.
    await db().execute(sql`update commerce.access_requests set confirm_expires_at = now() - interval '8 days' where lower(email) = lower(${email})`);
    expect(await signup.pruneUnconfirmedSignups()).toBeGreaterThanOrEqual(1);
    expect(await requestOf(email)).toBeUndefined();
  });

  it("keeps a confirmed request for a platform admin while the switch is off", async () => {
    const email = `off-${run}@example.com`;
    await signup.startSelfSignup(input(email), null);
    const token = await linkSentTo(email);
    await signup.setSelfServe(admin as never, false);
    expect(await signup.confirmSelfSignup(token)).toEqual({ ok: false, problem: "off" });
    expect(await requestOf(email)).toMatchObject({ status: "pending", store_id: null });
    expect((await listAccessRequests()).some((r) => r.email === email)).toBe(true);
  });

  it("holds sign-ups to 3 an address a day and 20 a network an hour, counted by hashes only", async () => {
    const email = `many-${run}@example.com`;
    for (let i = 0; i < signup.SIGNUPS_PER_ADDRESS_DAY; i++) expect(await signup.takeSignupSlot(email, null)).toBe(true);
    expect(await signup.takeSignupSlot(email, null)).toBe(false);
    const network = `192.0.2.7-${run}`;
    for (let i = 0; i < signup.SIGNUPS_PER_NETWORK_HOUR; i++) expect(await signup.takeSignupSlot(`n${i}-${run}@example.com`, network)).toBe(true);
    expect(await signup.takeSignupSlot(`last-${run}@example.com`, network)).toBe(false);
    const [kept] = await db().execute<Row>(sql`select count(*)::int as n from commerce.chat_usage where bucket like ${`%${email}%`} or bucket like ${`%${network}%`}`);
    expect(kept.n).toBe(0);
    // A limited sign-up sends nothing and says nothing different.
    await signup.startSelfSignup(input(email), null);
    const [{ n }] = await db().execute<Row>(sql`select count(*)::int as n from commerce.email_messages where to_address = ${email}`);
    expect(n).toBe(0);
  });
});

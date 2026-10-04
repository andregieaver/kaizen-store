import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { FRESH_SIGN_IN_MINUTES } from "@/lib/privacy-request";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("./document-html", () => ({ documentHtml: () => "<html></html>" }));

/** The shopper's browser: one cookie jar, which a test can swap for another person's. */
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.cookies.set(name, value),
    delete: (name: string) => void jar.cookies.delete(name),
  }),
}));
const stripe = vi.hoisted(() => ({ fail: false, cancelled: [] as string[], detached: [] as string[] }));
vi.mock("./stripe", () => ({
  WEBHOOK_EVENTS: [],
  platformStripe: () => ({
    subscriptions: {
      cancel: async (id: string) => {
        if (stripe.fail) throw new Error("down");
        stripe.cancelled.push(id);
        return { id, status: "canceled", ended_at: Math.floor(Date.now() / 1000), metadata: {}, items: { data: [] }, cancel_at_period_end: false, cancel_at: null, pause_collection: null, trial_end: null };
      },
    },
    paymentMethods: {
      detach: async (id: string) => {
        if (stripe.fail) throw new Error("down");
        stripe.detached.push(id);
        return { id };
      },
    },
  }),
}));

const fx = await import("./invoice-test-fixture");
const { buildSubject } = await import("./privacy-fixture");
const customers = await import("./customers");
const shopper = await import("./privacy-shopper");
const { auditRows } = await import("./trust-fixtures");

type Row = Record<string, unknown>;

/**
 * The shopper's own download and deletion (D162, G4 and G10): a fresh sign-in (a code or the password within ten minutes) is needed, a stale
 * session gets nothing until it proves itself again, another person's session never gets this person's file, the deletion is the staff erasure
 * with the session ended, and a failure at Stripe changes nothing.
 */

let store: Awaited<ReturnType<typeof fx.makeStore>>;
beforeAll(async () => {
  store = await fx.makeStore("shopper");
}, 60_000);
afterAll(async () => {
  await closeDb();
});

const cookieKey = () => `account_${store.storeId}`;
/** Signs the account in by the code flow, as the sign-in page does, in this browser. */
async function signIn(email: string): Promise<string> {
  jar.cookies.clear();
  const code = await customers.createSignInCode(store.storeId, email);
  const id = (await customers.verifySignInCode(store.storeId, email, code!))!;
  await customers.startSession(store.storeId, id);
  return id;
}
const staleSession = () => db().execute(sql`update commerce.customer_sessions set verified_at = now() - interval '11 minutes' where store_id = ${store.storeId}::uuid`);

describe("a fresh sign-in is needed to download (G4)", () => {
  it("gives a signed-out browser nothing, a fresh session its own file, and a stale one nothing until it proves itself with a code", async () => {
    const subject = await buildSubject(store, "dl", { sentinel: "OWN-1g" });
    const other = await buildSubject(store, "dl-other", { sentinel: "OTHER-1g" });
    jar.cookies.clear();
    expect(await shopper.shopperExport(store.storeId)).toEqual({ ok: false, problem: "signed_out" });
    const id = await signIn(subject.email);
    expect(id).toBe(subject.customerId);
    const fresh = await shopper.shopperExport(store.storeId);
    expect(fresh.ok).toBe(true);
    if (!fresh.ok || !("file" in fresh)) throw new Error("no file");
    // Their own file, in their own name, and never the other account's.
    expect(fresh.fileName).toMatch(/-my-data-/);
    const text = JSON.stringify(fresh.file);
    expect(text).toContain("OWN-1g");
    expect(text).not.toContain("OTHER-1g");
    expect(fresh.file.subject).toMatchObject({ accountId: subject.customerId, email: subject.email });
    // Eleven minutes later the session is stale: nothing, and the page sends them to the step-up.
    await staleSession();
    expect(await shopper.shopperExport(store.storeId)).toEqual({ ok: false, problem: "stale" });
    expect(await customers.isSessionFresh(store.storeId)).toBe(false);
    // A wrong code does not help; the right one does.
    const step = (await customers.startFreshSignIn(store.storeId, subject.customerId))!;
    expect(step.email).toBe(subject.email);
    expect(await customers.confirmFreshWithCode(store.storeId, subject.customerId, "000000")).toBe(false);
    expect(await shopper.shopperExport(store.storeId)).toEqual({ ok: false, problem: "stale" });
    expect(await customers.confirmFreshWithCode(store.storeId, subject.customerId, step.code)).toBe(true);
    expect((await shopper.shopperExport(store.storeId)).ok).toBe(true);
    // Another person's code never makes this session fresh for this account.
    await staleSession();
    const otherStep = (await customers.startFreshSignIn(store.storeId, other.customerId))!;
    expect(await customers.confirmFreshWithCode(store.storeId, subject.customerId, otherStep.code)).toBe(false);
    expect(await shopper.shopperExport(store.storeId)).toEqual({ ok: false, problem: "stale" });
  }, 120_000);

  it("takes a password for a password account, locks after wrong tries like sign-in, and the window is ten minutes", async () => {
    const subject = await buildSubject(store, "pw");
    await signIn(subject.email);
    await customers.setPassword(store.storeId, subject.customerId, "blå fjord seiler stille");
    expect(FRESH_SIGN_IN_MINUTES).toBe(10);
    // Nine minutes is still fresh, eleven is not.
    await db().execute(sql`update commerce.customer_sessions set verified_at = now() - interval '9 minutes' where store_id = ${store.storeId}::uuid`);
    expect(await customers.isSessionFresh(store.storeId)).toBe(true);
    await staleSession();
    expect(await customers.isSessionFresh(store.storeId)).toBe(false);
    expect(await customers.confirmFreshWithPassword(store.storeId, subject.customerId, "wrong password here")).toMatchObject({ ok: false });
    expect(await customers.isSessionFresh(store.storeId)).toBe(false);
    expect(await customers.confirmFreshWithPassword(store.storeId, subject.customerId, "blå fjord seiler stille")).toMatchObject({ ok: true });
    expect(await customers.isSessionFresh(store.storeId)).toBe(true);
  }, 120_000);

  it("starts a session that was not proven just now (the one-time sign-in after checkout) stale", async () => {
    const subject = await buildSubject(store, "checkout");
    jar.cookies.clear();
    await customers.startSession(store.storeId, subject.customerId, { verified: false });
    expect(await customers.isSessionFresh(store.storeId)).toBe(false);
    expect(await shopper.shopperExport(store.storeId)).toEqual({ ok: false, problem: "stale" });
  });
});

describe("the shopper deletes their own account (G10)", () => {
  it("shows what goes and what stays before it runs, and a stale session deletes nothing", async () => {
    const subject = await buildSubject(store, "plan");
    await signIn(subject.email);
    const view = await shopper.shopperErasurePlan(store.storeId);
    if (!view.ok) throw new Error(view.problem);
    expect(view.fresh).toBe(true);
    expect(view.plan.alsoHappens).toMatchObject({ subscriptionsCancelled: 1, savedCardsDetached: 1, emailOptOutKept: true });
    expect(view.plan.rows.find((r) => r.table === "orders" && r.action === "restricted")?.keptUntil).toBeDefined();
    await staleSession();
    expect(await shopper.shopperErase(store.storeId)).toEqual({ ok: false, problem: "stale" });
    expect(await db().execute(sql`select 1 from commerce.customers where id = ${subject.customerId}::uuid`)).toHaveLength(1);
  }, 120_000);

  it("runs the same erasure with the shopper as the actor, ends the session, logs it without a name, and leaves nothing for the same email to relink", async () => {
    const subject = await buildSubject(store, "bye");
    await signIn(subject.email);
    stripe.cancelled.length = 0;
    const result = await shopper.shopperErase(store.storeId);
    expect(result).toMatchObject({ ok: true, outcome: "erased" });
    expect(stripe.cancelled).toHaveLength(1);
    expect(jar.cookies.has(cookieKey())).toBe(false);
    expect(await db().execute(sql`select 1 from commerce.customers where id = ${subject.customerId}::uuid`)).toHaveLength(0);
    const [request] = await db().execute<Row>(sql`select channel, status, outcome, handled_by, subject_email from commerce.privacy_requests where id = ${(result as { requestId: string }).requestId}::uuid`);
    expect(request).toMatchObject({ channel: "shopper", status: "done", outcome: "erased", handled_by: null, subject_email: null });
    const entry = (await auditRows(store.storeId, "customer.erased")).find((e) => (e.details as { customer?: string }).customer === subject.customerId)!;
    expect(entry).toMatchObject({ account_id: null });
    expect(entry.details).toMatchObject({ by: "shopper" });
    expect(JSON.stringify(entry.details)).not.toContain(subject.email);
    // The confirmation reached the address once, and the log row holds no address; no owner is told of the shopper's own deletion.
    const confirmations = await db().execute<Row>(sql`select to_address from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = 'privacy.erased' and idempotency_key = ${`privacy.erased:${(result as { requestId: string }).requestId}`}`);
    expect(confirmations).toEqual([{ to_address: "[removed]" }]);
    // The same person signs up again and sees none of the old orders.
    const again = await signIn(subject.email);
    expect(again).not.toBe(subject.customerId);
    expect(await customers.listCustomerOrders(store.storeId, again)).toEqual([]);
    const file = await shopper.shopperExport(store.storeId);
    if (!file.ok || !("file" in file)) throw new Error("no file");
    expect(file.file.counts.orders).toBe(0);
  }, 120_000);

  it("changes nothing when Stripe does not answer, and keeps the session so the shopper can try again", async () => {
    const subject = await buildSubject(store, "stuck");
    await signIn(subject.email);
    stripe.fail = true;
    const result = await shopper.shopperErase(store.storeId);
    stripe.fail = false;
    expect(result).toMatchObject({ ok: false, problem: "stripe", message: "Stripe did not answer; nothing was changed. Try again." });
    expect(jar.cookies.has(cookieKey())).toBe(true);
    expect(await db().execute(sql`select 1 from commerce.customers where id = ${subject.customerId}::uuid`)).toHaveLength(1);
    // The request stays open for the retry (and the nightly resume).
    const [open] = await db().execute<Row>(sql`select status from commerce.privacy_requests where store_id = ${store.storeId}::uuid and subject_customer_id = ${subject.customerId}::uuid`);
    expect(open.status).toBe("open");
    const retry = await shopper.shopperErase(store.storeId);
    expect(retry).toMatchObject({ ok: true, outcome: "erased" });
  }, 120_000);

  it("never deletes another store's account of the same person", async () => {
    const other = await fx.makeStore("shopper-b");
    const mine = await buildSubject(store, "tenant");
    const theirs = await buildSubject(other, "tenant", { email: mine.email });
    await signIn(mine.email);
    expect(await shopper.shopperErase(store.storeId)).toMatchObject({ ok: true });
    expect(await db().execute(sql`select 1 from commerce.customers where id = ${theirs.customerId}::uuid`)).toHaveLength(1);
  }, 120_000);
});

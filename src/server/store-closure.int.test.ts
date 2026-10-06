import { sql } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { addMember, auditRows, fakeAuthState, fakeSupabase, linkAuthUser, makeAccount, makeStore, run } from "./trust-fixtures";

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

const closure = await import("./store-closure");
const permissions = await import("./permissions");
const closePage = (await import("../app/admin/(gated)/[store]/settings/close/page")).default;
const closeActions = await import("../app/admin/(gated)/[store]/settings/close/actions");
const platformPage = (await import("../app/admin/(gated)/platform/stores/[store]/page")).default;
const platformActions = await import("../app/admin/(gated)/platform/stores/[store]/actions");

type Row = Record<string, unknown>;

/**
 * Closing a store (D171, docs/store-closure.md): the database's steps and its refusal of orders in a store that is not open, what is counted as open, the
 * owner's closing with its typed address and its blockers, the platform's suspension and forced closing, reopening within the owner's thirty days, and what a
 * member may still do in a store that is not open.
 */

/** The database's refusal, by the code its message starts with: the driver wraps it, so the cause is read too. */
async function refused(work: PromiseLike<unknown>, code: RegExp): Promise<void> {
  try {
    await work;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause?.message ?? "";
    expect(`${(error as Error).message} ${cause}`).toMatch(code);
    return;
  }
  throw new Error("The database took it, and should have refused.");
}

let n = 0;
async function variantOf(storeId: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${storeId}::uuid limit 1`);
  return String(row.id);
}

/** An order of the store: its status, whether its goods are physical, and whether its payment is a test one. */
async function order(storeId: string, status: "paid" | "pending_payment" | "fulfilled", opts: { delivery?: "physical" | "digital"; test?: boolean } = {}): Promise<string> {
  const number = `${run}-${++n}`;
  const [o] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
    values (${storeId}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', ${`${number}@example.com`}, ${status}::commerce.order_status, 10000, 0, 0, 2000, 10000, '{"name":"A"}'::jsonb, '{"name":"A","line1":"G 1","postalCode":"0150","city":"Oslo","country":"NO"}'::jsonb)
    returning id
  `);
  const id = String(o.id);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
    values (${storeId}::uuid, ${id}::uuid, ${await variantOf(storeId)}::uuid, 'X', 'Thing', 1, 10000, 100, 10000, 2000, 0.25, 'txcd_99999999', ${opts.delivery ?? "physical"}::commerce.delivery)
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, kaizen_fee_minor, currency, status, test_mode)
    values (${storeId}::uuid, ${id}::uuid, 'stripe', ${`pi_${run}_${n}`}, 10000, 0, 'NOK', ${status === "pending_payment" ? "pending" : "captured"}::commerce.payment_status, ${Boolean(opts.test)})
  `);
  return id;
}

const statusOf = async (storeId: string) => {
  const [row] = await db().execute<Row>(sql`select status, status_reason, closed_at from commerce.stores where id = ${storeId}::uuid`);
  return { status: String(row.status), reason: row.status_reason as string | null, closedAt: row.closed_at as string | null };
};

const orderStatus = async (id: string) => String(((await db().execute<Row>(sql`select status from commerce.orders where id = ${id}::uuid`))[0] as Row).status);

let platformAdmin: Awaited<ReturnType<typeof makeAccount>>;

beforeAll(async () => {
  platformAdmin = await makeAccount("platform", { platformAdmin: true });
});
afterAll(async () => {
  await closeDb();
});

describe("the database's rules for a store's status", () => {
  it("takes the steps open to suspended or closed, suspended to open or closed, closed to open, and no other", async () => {
    const s = await makeStore("scsteps");
    const set = (to: string) => db().execute(sql`update commerce.stores set status = ${to}::commerce.store_status where id = ${s.id}::uuid`);
    await set("suspended");
    await expect(set("suspended")).resolves.toBeDefined(); // no change is no step
    await set("closed");
    expect((await statusOf(s.id)).status).toBe("closed");
    await refused(set("suspended"), /stores\.status_step/);
    await set("active");
    expect((await statusOf(s.id)).status).toBe("active");
  });

  it("sets closed_at when a store is closed, leaves it for a suspension and clears it with the reason on reopening", async () => {
    const s = await makeStore("scdates");
    await db().execute(sql`update commerce.stores set status = 'suspended', status_reason = 'Unpaid' where id = ${s.id}::uuid`);
    expect((await statusOf(s.id)).closedAt).toBeNull();
    await db().execute(sql`update commerce.stores set status = 'closed' where id = ${s.id}::uuid`);
    expect((await statusOf(s.id)).closedAt).not.toBeNull();
    await db().execute(sql`update commerce.stores set status = 'active' where id = ${s.id}::uuid`);
    expect(await statusOf(s.id)).toMatchObject({ status: "active", closedAt: null, reason: null });
  });

  it("keeps the template store open", async () => {
    await refused(db().execute(sql`update commerce.stores set status = 'closed' where is_template`), /stores\.template_status/);
  });

  it("takes no order in a store that is not open, and still takes one in a store that is", async () => {
    const s = await makeStore("scorders");
    await order(s.id, "paid");
    await db().execute(sql`update commerce.stores set status = 'suspended' where id = ${s.id}::uuid`);
    await refused(order(s.id, "pending_payment"), /orders\.store_not_open/);
    await db().execute(sql`update commerce.stores set status = 'closed' where id = ${s.id}::uuid`);
    await refused(order(s.id, "pending_payment"), /orders\.store_not_open/);
    await db().execute(sql`update commerce.stores set status = 'active' where id = ${s.id}::uuid`);
    await expect(order(s.id, "paid")).resolves.toBeTruthy();
  });

  it("answers store_is_active for open, suspended, closed and a store that does not exist", async () => {
    const s = await makeStore("scactive");
    const is = async (id: string) => Boolean(((await db().execute<Row>(sql`select commerce.store_is_active(${id}::uuid) as a`))[0] as Row).a);
    expect(await is(s.id)).toBe(true);
    await db().execute(sql`update commerce.stores set status = 'suspended' where id = ${s.id}::uuid`);
    expect(await is(s.id)).toBe(false);
    expect(await is("00000000-0000-0000-0000-000000000000")).toBe(false);
  });
});

describe("what a store still has open", () => {
  it("counts paid goods to send, but not digital goods, fulfilled orders or test payments, and waiting checkouts apart", async () => {
    const s = await makeStore("scopen");
    expect((await closure.storeObligations(s.id)).paidUnshipped).toBe(0);
    await order(s.id, "paid");
    await order(s.id, "paid", { delivery: "digital" });
    await order(s.id, "paid", { test: true });
    await order(s.id, "fulfilled");
    await order(s.id, "pending_payment");
    expect(await closure.storeObligations(s.id)).toMatchObject({ paidUnshipped: 1, openCheckouts: 1, runningSubscriptions: 0, runningDeliveries: 0, livePlan: false });
  });
});

describe("closing a store as its owner", () => {
  it("wants the store's address typed, and nothing is closed without it", async () => {
    const s = await makeStore("sctyped");
    const none = await closure.closeStore(s.account, s.id, { by: "owner", typed: "" });
    expect(none).toEqual({ ok: false, problems: ["Type the store's address to confirm."] });
    const wrong = await closure.closeStore(s.account, s.id, { by: "owner", typed: "other" });
    expect(wrong.ok).toBe(false);
    expect((await statusOf(s.id)).status).toBe("active");
  });

  it("is blocked while paid goods are unsent, and works once they are sent", async () => {
    const s = await makeStore("scblocked");
    const id = await order(s.id, "paid");
    const refused = await closure.closeStore(s.account, s.id, { by: "owner", typed: s.slug });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.problems[0]).toMatch(/1 paid order has goods still to send/);
    expect((await statusOf(s.id)).status).toBe("active");
    await db().execute(sql`update commerce.orders set status = 'fulfilled' where id = ${id}::uuid`);
    expect((await closure.closeStore(s.account, s.id, { by: "owner", typed: s.slug })).ok).toBe(true);
    expect((await statusOf(s.id)).status).toBe("closed");
  });

  it("cancels orders waiting for payment, releases the domains, keeps every sale and writes the log", async () => {
    const s = await makeStore("scclosing");
    const waiting = await order(s.id, "pending_payment");
    const sold = await order(s.id, "fulfilled");
    await db().execute(sql`
      insert into commerce.store_domains (store_id, hostname, token, status, is_primary) values (${s.id}::uuid, ${`${s.slug}.example.test`}, 'tok', 'pending', false)
    `);
    const result = await closure.closeStore(s.account, s.id, { by: "owner", typed: `  ${s.slug.toUpperCase()} ` });
    expect(result.ok).toBe(true);
    expect(await orderStatus(waiting)).toBe("cancelled");
    expect(await orderStatus(sold)).toBe("fulfilled");
    const [domains] = await db().execute<Row>(sql`select count(*)::int as n from commerce.store_domains where store_id = ${s.id}::uuid`);
    expect(domains.n).toBe(0);
    expect(await auditRows(s.id, "store.closed")).toHaveLength(1);
    expect(await auditRows(s.id, "store.domain_removed")).toHaveLength(1);
    const again = await closure.closeStore(s.account, s.id, { by: "owner", typed: s.slug });
    expect(again).toEqual({ ok: false, problems: ["The store is already closed."] });
  });

  it("is not for a suspended store, whose owner is told to write to Kaizen", async () => {
    const s = await makeStore("scsuspended");
    expect((await closure.suspendStore(platformAdmin, s.id, "Selling something we do not allow")).ok).toBe(true);
    const result = await closure.closeStore(s.account, s.id, { by: "owner", typed: s.slug });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toMatch(/suspended/);
  });
});

describe("the platform's suspension and closing", () => {
  it("is for a platform admin only", async () => {
    const s = await makeStore("sconly");
    expect(await closure.suspendStore(s.account, s.id, "No right to do this")).toEqual({ ok: false, problems: ["Only the platform can do this."] });
    expect(await closure.closeStore(s.account, s.id, { by: "platform", reason: "No right to do this" })).toEqual({ ok: false, problems: ["Only the platform can do this."] });
    expect(await closure.reopenStore(s.account, s.id, { by: "platform" })).toEqual({ ok: false, problems: ["The store is already open."] });
    expect((await statusOf(s.id)).status).toBe("active");
  });

  it("suspends with a reason, refuses a second suspension and logs it", async () => {
    const s = await makeStore("scsuspend");
    expect((await closure.suspendStore(platformAdmin, s.id, "Chargebacks")).ok).toBe(true);
    expect(await statusOf(s.id)).toMatchObject({ status: "suspended", reason: "Chargebacks" });
    expect((await closure.suspendStore(platformAdmin, s.id, "Chargebacks")).ok).toBe(false);
    expect(await auditRows(s.id, "store.suspended")).toHaveLength(1);
  });

  it("closes past what blocks an owner only when forced, and keeps the reason", async () => {
    const s = await makeStore("scforced");
    await order(s.id, "paid");
    expect((await closure.closeStore(platformAdmin, s.id, { by: "platform", reason: "Fraud" })).ok).toBe(false);
    expect((await closure.closeStore(platformAdmin, s.id, { by: "platform", reason: "Fraud", force: true })).ok).toBe(true);
    expect(await statusOf(s.id)).toMatchObject({ status: "closed", reason: "Fraud" });
  });
});

describe("reopening", () => {
  it("is the owner's for thirty days after closing, then the platform's alone", async () => {
    const s = await makeStore("screopen");
    await closure.closeStore(s.account, s.id, { by: "owner", typed: s.slug });
    await db().execute(sql`update commerce.stores set closed_at = now() - interval '31 days' where id = ${s.id}::uuid`);
    const late = await closure.reopenStore(s.account, s.id, { by: "owner" });
    expect(late.ok).toBe(false);
    expect((await statusOf(s.id)).status).toBe("closed");
    expect((await closure.reopenStore(platformAdmin, s.id, { by: "platform" })).ok).toBe(true);
    expect(await statusOf(s.id)).toMatchObject({ status: "active", closedAt: null });
    expect(await auditRows(s.id, "store.reopened")).toHaveLength(1);
  });

  it("is the owner's within the thirty days, and sales work again", async () => {
    const s = await makeStore("scwithin");
    await closure.closeStore(s.account, s.id, { by: "owner", typed: s.slug });
    expect((await closure.reopenStore(s.account, s.id, { by: "owner" })).ok).toBe(true);
    await expect(order(s.id, "paid")).resolves.toBeTruthy();
  });

  it("is never the owner's for a suspension", async () => {
    const s = await makeStore("scnever");
    await closure.suspendStore(platformAdmin, s.id, "Under review");
    const result = await closure.reopenStore(s.account, s.id, { by: "owner" });
    expect(result.ok).toBe(false);
    expect((await statusOf(s.id)).status).toBe("suspended");
  });
});

describe("what a member may do in a store that is not open", () => {
  it("is to read and handle what was sold, and to reopen, whatever the role holds", async () => {
    const s = await makeStore("scmembers");
    const owner = await linkAuthUser(s.account.id);
    auth.client = fakeSupabase(fakeAuthState({ sub: owner }));
    expect(await permissions.checkPermission(s.slug, "products:write")).not.toBeNull();
    await closure.closeStore(s.account, s.id, { by: "owner", typed: s.slug });
    // The cached store is not cached in tests: the member still reaches the closed store, and only what is left to them.
    expect(await permissions.checkPermission(s.slug, "owner")).not.toBeNull();
    expect(await permissions.checkPermission(s.slug, "orders:write")).not.toBeNull();
    expect(await permissions.checkPermission(s.slug, "customers:read")).not.toBeNull();
    expect(await permissions.checkPermission(s.slug, "products:write")).toBeNull();
    expect(await permissions.checkPermission(s.slug, "website:write")).toBeNull();
    expect(await permissions.checkPermission(s.slug, "settings:write")).toBeNull();
    const staff = await makeAccount("staff");
    await addMember(s.id, staff.id, "admin");
    const sub = await linkAuthUser(staff.id);
    auth.client = fakeSupabase(fakeAuthState({ sub }));
    expect(await permissions.checkPermission(s.slug, "orders:read")).not.toBeNull();
    expect(await permissions.checkPermission(s.slug, "owner")).toBeNull();
  });
});

/** The signed-in owner, with or without a sign-in from the last minutes (the token's `amr`). */
function signInAs(sub: string, fresh: boolean, aal: "aal1" | "aal2" = "aal1") {
  const client = fakeSupabase(fakeAuthState({ sub, aal }));
  const getClaims = client.auth.getClaims.bind(client.auth);
  client.auth.getClaims = async () => {
    const result = await getClaims();
    if (!result.data) return result;
    const timestamp = Math.floor(Date.now() / 1000) - (fresh ? 30 : 86_400);
    return { ...result, data: { ...result.data, claims: { ...result.data.claims, amr: [{ method: "password", timestamp }] } } };
  };
  auth.client = client;
}

const render = async (slug: string) => renderToStaticMarkup(await closePage({ params: Promise.resolve({ store: slug }) } as never));

describe("the owner's page and actions", () => {
  it("shows what blocks, asks for a fresh sign-in, then for the address, and closes the store", async () => {
    const s = await makeStore("scpage");
    const sub = await linkAuthUser(s.account.id);
    const sent = await order(s.id, "paid");
    signInAs(sub, false);
    const blocked = await render(s.slug);
    expect(blocked).toContain("Close store");
    expect(blocked).toContain("Before you can close it");
    expect(blocked).toContain("1 paid order has goods still to send");
    expect(blocked).not.toContain('name="address"');
    await db().execute(sql`update commerce.orders set status = 'fulfilled' where id = ${sent}::uuid`);

    const stale = await render(s.slug);
    expect(stale).toContain("Sign in again first");
    expect(stale).not.toContain('name="address"');
    const refusal = await closeActions.closeStoreAction(s.slug, { status: "idle", messages: [] }, new FormData());
    expect(refusal.messages[0]).toMatch(/Sign in again/);
    expect((await statusOf(s.id)).status).toBe("active");

    signInAs(sub, true);
    expect(await render(s.slug)).toContain('name="address"');
    const wrong = new FormData();
    wrong.set("address", "nope");
    expect((await closeActions.closeStoreAction(s.slug, { status: "idle", messages: [] }, wrong)).messages[0]).toMatch(/Type the store's address/);
    const right = new FormData();
    right.set("address", s.slug);
    await expect(closeActions.closeStoreAction(s.slug, { status: "idle", messages: [] }, right)).rejects.toThrow(`REDIRECT:/admin/${s.slug}/settings/close`);
    expect((await statusOf(s.id)).status).toBe("closed");

    const closed = await render(s.slug);
    expect(closed).toContain("This store is closed");
    expect(closed).toContain("Reopen the store");
    await expect(closeActions.reopenStoreAction(s.slug, { status: "idle", messages: [] }, new FormData())).rejects.toThrow(`REDIRECT:/admin/${s.slug}`);
    expect((await statusOf(s.id)).status).toBe("active");
  });

  it("is the owner's: an admin of the store is refused, and its page is a 404", async () => {
    const s = await makeStore("scadmin");
    const staff = await makeAccount("scstaff");
    await addMember(s.id, staff.id, "admin");
    signInAs(await linkAuthUser(staff.id), true);
    const result = await closeActions.closeStoreAction(s.slug, { status: "idle", messages: [] }, new FormData());
    expect(result.messages[0]).toMatch(/do not have access/);
    await expect(render(s.slug)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("tells a closed store's owner, after thirty days, to ask Kaizen", async () => {
    const s = await makeStore("sclate");
    const sub = await linkAuthUser(s.account.id);
    await closure.closeStore(s.account, s.id, { by: "owner", typed: s.slug });
    await db().execute(sql`update commerce.stores set closed_at = now() - interval '40 days' where id = ${s.id}::uuid`);
    signInAs(sub, true);
    const page = await render(s.slug);
    expect(page).toContain("The thirty days for reopening ended");
    expect(page).not.toContain("Reopen the store</button>");
  });
});

describe("the platform's page and actions", () => {
  it("offers suspend and close for an open store, reopen for one that is not, and asks a reason", async () => {
    const s = await makeStore("scplat");
    const admin = await makeAccount("scadminplat", { platformAdmin: true });
    signInAs(await linkAuthUser(admin.id), true, "aal2");
    const view = async () => renderToStaticMarkup(await platformPage({ params: Promise.resolve({ store: s.slug }) } as never));
    const open = await view();
    expect(open).toContain("Store status: Open");
    expect(open).toContain("Suspend the store");
    expect(open).toContain("Close the store");

    const idle = { status: "idle" as const, messages: [] };
    const noReason = new FormData();
    expect((await platformActions.suspendStoreAction(s.id, idle, noReason)).status).toBe("error");
    const reason = new FormData();
    reason.set("reason", "Selling what we do not allow");
    expect((await platformActions.suspendStoreAction(s.id, idle, reason)).status).toBe("ok");
    const suspended = await view();
    expect(suspended).toContain("Store status: Suspended");
    expect(suspended).toContain("Selling what we do not allow");
    expect(suspended).toContain("Reopen the store");
    expect((await platformActions.reopenStoreForPlatformAction(s.id, idle, new FormData())).status).toBe("ok");
    expect((await platformActions.closeStoreForPlatformAction(s.id, idle, reason)).status).toBe("ok");
    expect(await view()).toContain("Store status: Closed");
  });

  it("is for a platform admin only", async () => {
    const s = await makeStore("scnoplat");
    signInAs(await linkAuthUser(s.account.id), true);
    const reason = new FormData();
    reason.set("reason", "Because I can");
    await expect(platformActions.suspendStoreAction(s.id, { status: "idle", messages: [] }, reason)).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await statusOf(s.id)).status).toBe("active");
  });
});

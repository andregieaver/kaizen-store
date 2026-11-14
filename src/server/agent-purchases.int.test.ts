import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { sealWalletState } = await import("@/lib/card-wallet");
const { parseKey } = await import("@/lib/secret-box");
const wallets = await import("./card-wallet");
const purchases = await import("./agent-purchases");
const { getStore } = await import("./stores");
type Store = import("./stores").Store;
type Account = import("./auth").Account;
type Membership = import("./auth").Membership;
type WalletFetch = import("./card-wallet").WalletFetch;

/** The AI's card wallet and its purchases (D599), Airwallex stood in for. */

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const app = { clientId: "kaizena-test-client", clientSecret: "kaizena-test-secret", mode: "sandbox" as const };
let store: Store;
let actor: Account;
let clock = new Date("2026-11-14T10:00:00Z");

/** Airwallex as the wallet sees it: tokens that turn over, cardholders, cards made once per request id, their transactions and closing. */
function fakeAirwallex() {
  const state = {
    access: "",
    refresh: "",
    n: 0,
    refuseRefresh: false,
    cardholders: [{ cardholder_id: "ch_kari", status: "READY", individual: { name: { first_name: "Kari", last_name: "Nordmann" } } }] as unknown[],
    cards: new Map<string, { id: string; body: Record<string, unknown> }>(),
    transactions: new Map<string, unknown[]>(),
    closed: [] as string[],
    tokenCalls: [] as string[],
  };
  const issue = () => {
    state.n++;
    state.access = `access-token-${state.n}-${run}`;
    state.refresh = `refresh-token-${state.n}-${run}`;
    return { access_token: state.access, refresh_token: state.refresh, expires_in: 300, refresh_token_expires_in: 7_776_000, account_id: "acct_kaizena_test", token_type: "bearer" };
  };
  const fetcher: WalletFetch = async (url, init) => {
    const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    const u = new URL(url);
    if (u.pathname === "/oauth/token") {
      const form = new URLSearchParams(init.body);
      state.tokenCalls.push(form.get("grant_type") ?? "");
      if (form.get("client_secret") !== app.clientSecret) return answer(401, { code: "unauthorized" });
      if (form.get("grant_type") === "authorization_code") return form.get("code") === "good-code" ? answer(200, issue()) : answer(400, { code: "invalid_grant" });
      if (state.refuseRefresh || form.get("refresh_token") !== state.refresh) return answer(400, { code: "invalid_grant" });
      return answer(200, issue());
    }
    if (init.headers.Authorization !== `Bearer ${state.access}`) return answer(401, { code: "credentials_expired" });
    if (u.pathname === "/api/v1/issuing/cardholders") return answer(200, { items: state.cardholders, has_more: false });
    if (u.pathname === "/api/v1/issuing/cards/create") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const id = String(body.request_id);
      if (!state.cards.has(id)) state.cards.set(id, { id: `card_${state.cards.size + 1}`, body });
      return answer(202, { card_id: state.cards.get(id)!.id, card_number: "************4111", card_status: "ACTIVE" });
    }
    if (u.pathname === "/api/v1/issuing/transactions") return answer(200, { items: state.transactions.get(u.searchParams.get("card_id") ?? "") ?? [], has_more: false });
    const update = /^\/api\/v1\/issuing\/cards\/([^/]+)\/update$/.exec(u.pathname);
    if (update) {
      state.closed.push(update[1]);
      return answer(200, { card_id: update[1], card_status: "CLOSED" });
    }
    return answer(404, { code: "not_found" });
  };
  return { fetcher, state };
}

const fake = fakeAirwallex();
const deps = { fetcher: fake.fetcher, app, now: () => clock };

const input = (amount: string, what = "Stock photos, ten pictures") => ({ what, merchant: "Pics AS", url: "https://pics.example/pack", amount, why: "For the autumn page" });

async function connect(): Promise<string> {
  const state = randomBytes(36).toString("base64url");
  const cookie = sealWalletState(parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!, { state, store: store.slug, account: actor.id }, clock.getTime());
  return wallets.finishWalletConnect(new URLSearchParams({ code: "good-code", state }), cookie, { ...deps, owner: async () => ({ account: actor, store, role: "owner" }) as Membership });
}

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`wallet-${run}@example.com`}, 'Kari', 'Lommebok') returning id
  `);
  await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`wallet-${run}`}, 'Lommebok', null) as id`);
  store = (await getStore(`wallet-${run}`))!;
  const [member] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${store.id}::uuid limit 1`);
  actor = { id: String(member.account_id), email: `wallet-${run}@example.com`, name: "Kari Nordmann", platformAdmin: false };
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.agent_purchases where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.card_wallets where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("connecting the owner's Airwallex (D599)", () => {
  it("keeps the grant encrypted, chooses the one ready cardholder and takes the store's currency", async () => {
    expect(await connect()).toBe(`/admin/wallet-${run}/assistant/autopilot?tab=settings&wallet=connected`);
    const wallet = await wallets.getWallet(store.id);
    expect(wallet).toMatchObject({ mode: "sandbox", accountId: "acct_kaizena_test", state: "on", paused: false, currency: store.markets[0].nativeCurrency, limitMinor: null, cardholderId: "ch_kari", cardholderName: "Kari Nordmann" });
    const [row] = await db().execute<Row>(sql`select access_token_encrypted, refresh_token_encrypted from commerce.card_wallets where store_id = ${store.id}::uuid`);
    expect(String(row.access_token_encrypted)).not.toContain(fake.state.access);
    expect(String(row.refresh_token_encrypted)).not.toContain(fake.state.refresh);
  });

  it("refuses a state another browser signed, and a code Airwallex refuses", async () => {
    const cookie = sealWalletState(parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!, { state: "a".repeat(48), store: store.slug, account: actor.id }, clock.getTime());
    expect(await wallets.finishWalletConnect(new URLSearchParams({ code: "good-code", state: "b".repeat(48) }), cookie, deps)).toMatch(/wallet=failed$/);
    expect(await wallets.finishWalletConnect(new URLSearchParams({ code: "good-code", state: "a".repeat(48) }), "forged.cookie", deps)).toBe("/admin");
  });
});

describe("a purchase on the owner's yes", () => {
  it("needs a monthly limit, then makes one single-use card for it", async () => {
    const refused = await purchases.makePurchase(store, actor, input("249.50"), deps);
    expect(refused).toMatchObject({ ok: false, problem: "no_limit" });
    expect(await wallets.setWalletLimit(store.id, actor.id, "1000")).toEqual({ ok: true });

    const preview = await purchases.previewPurchase(store, input("249.50"));
    expect(preview.ok && preview.words.replace(/ /g, " ")).toMatch(/^Make a single-use card for "Stock photos, ten pictures" from Pics AS, up to .*249\.50, open for 48 hours, in Kari Nordmann's Airwallex app\./);

    const made = await purchases.makePurchase(store, actor, input("249.50"), deps);
    if (!made.ok) throw new Error(made.words);
    expect(made.purchase).toMatchObject({ status: "card_ready", cardLast4: "4111", amountMinor: 24_950, merchant: "Pics AS", spentMinor: 0 });
    const card = fake.state.cards.get(made.purchase.id)!;
    expect(card.body).toMatchObject({
      cardholder_id: "ch_kari",
      authorization_controls: { allowed_transaction_count: "SINGLE", transaction_limits: { currency: store.markets[0].nativeCurrency, limits: [{ amount: 249.5 }, { amount: 249.5 }] } },
    });
    expect(await purchases.monthTaken(store.id, made.purchase.currency, store.timeZone)).toBe(24_950);
  });

  it("refuses what passes the month's limit, and two yeses at once never pass it together", async () => {
    expect(await purchases.makePurchase(store, actor, input("800"), deps)).toMatchObject({ ok: false, problem: "over_limit" });
    const both = await Promise.all([purchases.makePurchase(store, actor, input("400", "Template A"), deps), purchases.makePurchase(store, actor, input("400", "Template B"), deps)]);
    expect(both.filter((b) => b.ok)).toHaveLength(1);
    expect(both.find((b) => !b.ok)).toMatchObject({ problem: "over_limit" });
  });

  it("refreshes the five-minute token under the row's lock when it is due, and turns the refresh token over", async () => {
    const before = fake.state.refresh;
    clock = new Date(clock.getTime() + 10 * 60_000);
    expect((await wallets.listCardholders(store.id, deps)).ok).toBe(true);
    expect(fake.state.refresh).not.toBe(before);
    expect(fake.state.tokenCalls.at(-1)).toBe("refresh_token");
  });
});

describe("the five-minute job", () => {
  it("keeps a card's charges, marks it charged, then done and closed once cleared", async () => {
    const [first] = (await purchases.listPurchases(store.id)).filter((p) => p.what === "Stock photos, ten pictures");
    const currency = first.currency;
    const auth = { transaction_id: `tx-a-${run}`, card_id: first.cardId, transaction_type: "AUTHORIZATION", status: "APPROVED", billing_amount: 249.5, billing_currency: currency, transaction_date: clock.toISOString(), merchant: { name: "PICS AS", category_code: "5815" } };
    fake.state.transactions.set(first.cardId!, [auth]);
    await purchases.syncAgentPurchases(deps);
    expect(await purchases.getPurchase(store.id, first.id)).toMatchObject({ status: "spent", spentMinor: 24_950, lastMerchant: "PICS AS" });

    fake.state.transactions.set(first.cardId!, [auth, { ...auth, transaction_id: `tx-c-${run}`, transaction_type: "CLEARING", billing_amount: 240 }]);
    await purchases.syncAgentPurchases(deps);
    expect(await purchases.getPurchase(store.id, first.id)).toMatchObject({ status: "closed", spentMinor: 24_000 });
    expect(fake.state.closed).toContain(first.cardId);
    const [{ n }] = await db().execute<Row>(sql`select count(*)::int as n from commerce.agent_purchase_charges where purchase_id = ${first.id}::uuid`);
    expect(n).toBe(2);
  });

  it("closes a card nobody used once its two days are over", async () => {
    const open = (await purchases.listPurchases(store.id)).find((p) => p.status === "card_ready")!;
    clock = new Date(new Date(open.activeTo).getTime() + 60_000);
    await purchases.syncAgentPurchases(deps);
    expect(await purchases.getPurchase(store.id, open.id)).toMatchObject({ status: "closed", spentMinor: 0 });
    expect(fake.state.closed).toContain(open.cardId);
  });
});

describe("the owner's switches", () => {
  it("pausing closes the open cards and refuses new ones until switched on", async () => {
    const made = await purchases.makePurchase(store, actor, input("100", "Font licence"), deps);
    if (!made.ok) throw new Error(made.words);
    await wallets.setWalletPaused(store.id, actor.id, true);
    expect(await purchases.closeOpenCards(store.id, actor.id, deps)).toBe(1);
    expect(await purchases.getPurchase(store.id, made.purchase.id)).toMatchObject({ status: "cancelled" });
    expect(await purchases.makePurchase(store, actor, input("100"), deps)).toMatchObject({ ok: false, problem: "paused" });
    await wallets.setWalletPaused(store.id, actor.id, false);
  });

  it("a refresh Airwallex refuses stops the wallet until the owner connects again", async () => {
    fake.state.refuseRefresh = true;
    clock = new Date(clock.getTime() + 10 * 60_000);
    expect(await wallets.listCardholders(store.id, deps)).toMatchObject({ ok: false, problem: "grant_refused" });
    expect((await wallets.getWallet(store.id))?.state).toBe("auth_failed");
    expect(await purchases.makePurchase(store, actor, input("100"), deps)).toMatchObject({ ok: false, problem: "auth_failed" });
    fake.state.refuseRefresh = false;
    expect(await connect()).toMatch(/wallet=connected$/);
    expect(await wallets.getWallet(store.id)).toMatchObject({ state: "on", limitMinor: 100_000, cardholderId: "ch_kari" });
  });
});

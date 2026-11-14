import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.AIRWALLEX_CLIENT_ID = "kaizena-tools-client";
process.env.AIRWALLEX_CLIENT_SECRET = "kaizena-tools-secret";
process.env.AIRWALLEX_MODE = "sandbox";

const { sealWalletState } = await import("@/lib/card-wallet");
const { parseKey } = await import("@/lib/secret-box");
const { finishWalletConnect, setWalletLimit } = await import("./card-wallet");
const tools = await import("./purchase-tools");
const { getStore } = await import("./stores");
type Store = import("./stores").Store;
type Account = import("./auth").Account;
type Membership = import("./auth").Membership;

/** The AI manager's wallet tools (D599 step 2b), Airwallex stood in for by a stub of `fetch`. */

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let store: Store;
let actor: Account;
const made: Record<string, unknown>[] = [];

/** Airwallex as the tools reach it: one token, one cardholder, cards made once per request id. */
const airwallex = async (url: string, init?: RequestInit) => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const path = new URL(url).pathname;
  if (path === "/oauth/token") return json(200, { access_token: `tools-access-${run}`, refresh_token: `tools-refresh-${run}`, expires_in: 3600, account_id: "acct_tools" });
  if (path === "/api/v1/issuing/cardholders") return json(200, { items: [{ cardholder_id: "ch_owner", status: "READY", individual: { name: { first_name: "Kari", last_name: "Nordmann" } } }] });
  if (path === "/api/v1/issuing/cards/create") {
    made.push(JSON.parse(String(init?.body)));
    return json(202, { card_id: `card_tools_${made.length}`, card_number: "************7007", card_status: "ACTIVE" });
  }
  if (/\/update$/.test(path)) return json(200, { card_status: "CLOSED" });
  return json(404, { code: "not_found" });
};

beforeAll(async () => {
  vi.stubGlobal("fetch", airwallex);
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`wallet-tools-${run}@example.com`}, 'Kari', 'Verktøy') returning id
  `);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`wallet-tools-${run}`}, 'Verktøy', null)`);
  store = (await getStore(`wallet-tools-${run}`))!;
  const [member] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${store.id}::uuid limit 1`);
  actor = { id: String(member.account_id), email: `wallet-tools-${run}@example.com`, name: "Kari Nordmann", platformAdmin: false };
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await db().execute(sql`delete from commerce.agent_purchases where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.card_wallets where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("the AI manager's wallet tools (D599)", () => {
  it("say there is no wallet, and refuse a purchase before it is kept for a yes", async () => {
    expect(await tools.walletStatusTool({ account: actor, store })).toMatchObject({ connected: false });
    await expect(tools.preflightRequestPurchase({ account: actor, store }, { what: "Stock photos", merchant: "Pics AS", amount: "249", why: "" })).rejects.toThrow(/no card wallet/);
  });

  it("read the wallet once connected, and refuse without a monthly limit", async () => {
    const state = randomBytes(36).toString("base64url");
    const cookie = sealWalletState(parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!, { state, store: store.slug, account: actor.id });
    expect(await finishWalletConnect(new URLSearchParams({ code: "code", state }), cookie, { owner: async () => ({ account: actor, store, role: "owner" }) as Membership })).toMatch(/wallet=connected$/);
    expect(await tools.walletStatusTool({ account: actor, store })).toMatchObject({ connected: true, state: "On.", cards_for: "Kari Nordmann" });
    await expect(tools.preflightRequestPurchase({ account: actor, store }, { what: "Stock photos", merchant: "Pics AS", amount: "249", why: "" })).rejects.toThrow(/has not set what the AI's cards may take/);
  });

  it("word the approval from the wallet, make the card on the yes, list it and call it off", async () => {
    await setWalletLimit(store.id, actor.id, "2000");
    const input = { what: "Stock photos", merchant: "Pics AS", url: "https://pics.example/autumn", amount: "249.50", why: "For the autumn page" };
    await tools.preflightRequestPurchase({ account: actor, store }, input);
    expect((await tools.purchaseApprovalWords(store, input))?.replace(/ /g, " ")).toMatch(/^Make a single-use card for "Stock photos" from Pics AS, up to .*249\.50, open for 48 hours, in Kari Nordmann's Airwallex app\./);

    const done = await tools.requestPurchaseTool({ account: actor, store }, input);
    expect(done.done).toMatch(/card ending 7007/);
    expect(made[0]).toMatchObject({ cardholder_id: "ch_owner", authorization_controls: { allowed_transaction_count: "SINGLE" } });

    const listed = await tools.listPurchasesTool({ account: actor, store }, { limit: 10 });
    expect(listed.purchases).toEqual([expect.objectContaining({ id: done.purchase, merchant: "Pics AS", status: "ready to pay", card_ending: "7007", charged: null })]);
    expect(await tools.walletStatusTool({ account: actor, store })).toMatchObject({ left_this_month: expect.stringMatching(/1,750\.50/) });

    expect(await tools.cancelPurchaseTool({ account: actor, store }, { purchase: done.purchase })).toMatchObject({ done: "The purchase is cancelled and its card closed." });
    await expect(tools.cancelPurchaseTool({ account: actor, store }, { purchase: done.purchase })).rejects.toThrow(/already over/);
  });
});

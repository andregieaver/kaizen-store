import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { customPeriod } from "@/lib/analytics-period";
import { toRates } from "@/lib/currency";

vi.mock("server-only", () => ({}));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { liabilityRows } = await import("./liabilities");
const { bonusOverview } = await import("./bonus");
const { newGiftCode } = await import("./gift-card-codes");
const { storePaymentMode } = await import("./host-payments");
type Store = import("./stores").Store;

type Row = Record<string, unknown>;

/**
 * What the store owes customers on Finance (wave 11 unit B, D381): bonus credit and gift cards, each a roll-forward from the ledger's own sums
 * that adds up to the minor unit, with what is owed now beside it (bonus: the sum of `bonus_balance()`, equal to the bonus page's figure; gift
 * cards: delivered, live cards per currency, never converted). A period that ended before anything happened opens and closes at nothing.
 */

const run = Date.now().toString(36);
let store: Store;
let owner: string;
let today: string;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`liab-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`liab-${run}`}, 'Test', null) as id`);
  const id = String(created.id);
  store = {
    id,
    slug: `liab-${run}`,
    timeZone: "Europe/Oslo",
    markets: [{ nativeCurrency: "NOK", code: "NO" }],
    localization: { locales: ["nb-NO"], currencies: [], rates: toRates([]) },
  } as unknown as Store;
  const [m] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${id}::uuid limit 1`);
  owner = String(m.account_id);
  today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());
  await db().execute(sql`
    insert into commerce.bonus_settings (store_id, enabled, earn_bps, pending_days, max_redeem_percent, currency)
    values (${id}::uuid, true, 500, 14, 50, 'NOK') on conflict (store_id) do nothing
  `);
  const customer = async (email: string) =>
    String((await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name) values (${id}::uuid, ${email}, 'Test') returning id`))[0].id);
  const kari = await customer(`kari-${run}@example.com`);
  const ola = await customer(`ola-${run}@example.com`);
  const grant = (c: string, amount: number, availableDays = 0) =>
    db().execute(sql`
      select commerce.bonus_grant(${id}::uuid, ${c}::uuid, 'adjust', ${amount}, null, null, now() + make_interval(days => ${availableDays}), null, 'test', null, ${`g-${c}-${amount}-${availableDays}`})
    `);
  await grant(kari, 10_000);
  await grant(ola, 4_000);
  // Credits not usable yet are still owed.
  await grant(ola, 1_500, 3);
  await db().execute(sql`select commerce.bonus_adjust(${id}::uuid, ${kari}::uuid, -2_500, 'test', ${owner}::uuid, ${`a-${kari}`})`);

  const test = (await storePaymentMode(id)) === "test";
  const issue = async (currency: string, amount: number, deliver: boolean) => {
    const [card] = await db().execute<Row>(sql`
      select commerce.gift_card_issue(${id}::uuid, 'staff', ${currency}, ${amount}, null, null, null, ${owner}::uuid, ${test}, null, null, null, null, null, 'Test') as id
    `);
    if (deliver) {
      const code = newGiftCode()!;
      await db().execute(sql`select commerce.gift_card_set_code(${id}::uuid, ${String(card.id)}::uuid, ${code.hash}, ${code.last4})`);
      await db().execute(sql`select commerce.gift_card_mark_sent(${id}::uuid, ${String(card.id)}::uuid)`);
    }
    return String(card.id);
  };
  const nok = await issue("NOK", 50_000, true);
  await db().execute(sql`select commerce.gift_card_adjust(${id}::uuid, ${nok}::uuid, ${owner}::uuid, -1_000, 'test', ${`ga-${nok}`})`);
  // A card not delivered yet is in the ledger but held by nobody.
  await issue("EUR", 2_000, false);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("what the store owes customers (D381)", () => {
  it("rolls bonus credit forward to the minor unit, and owes now what the customers' balances add up to", async () => {
    const rows = await liabilityRows(store, customPeriod(today, today));
    const bonus = rows.find((r) => r.ledger === "bonus")!;
    expect(bonus).toMatchObject({ currency: "NOK", openingMinor: 0, closingMinor: 13_000, addsUp: true, differenceMinor: 0, owedNowMain: null });
    expect(bonus.columns).toMatchObject({ changed: 13_000, granted: 0, used: 0 });
    // Available and pending credits: 7 500 + 4 000 + 1 500.
    expect(bonus.owedNowMinor).toBe(13_000);
    const overview = await bonusOverview(store.id);
    expect(bonus.owedNowMinor).toBe(overview.outstandingMinor + overview.pendingMinor);
  });

  it("rolls gift cards forward per currency, never converted, with what delivered cards hold now", async () => {
    const rows = await liabilityRows(store, customPeriod(today, today));
    const nok = rows.find((r) => r.ledger === "gift_cards" && r.currency === "NOK")!;
    expect(nok).toMatchObject({ openingMinor: 0, closingMinor: 49_000, addsUp: true, owedNowMinor: 49_000 });
    expect(nok.columns).toMatchObject({ granted: 50_000, changed: -1_000 });
    const eur = rows.find((r) => r.ledger === "gift_cards" && r.currency === "EUR")!;
    expect(eur).toMatchObject({ openingMinor: 0, closingMinor: 2_000, addsUp: true, owedNowMinor: 0 });
  });

  it("opens the next period at the last one's closing, and a period before anything happened is all nothing", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    const next = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(tomorrow);
    // A period that has not started: it opens at what is owed now and nothing moved.
    const later = await liabilityRows(store, customPeriod(next, next));
    expect(later.find((r) => r.ledger === "bonus")).toMatchObject({ openingMinor: 13_000, closingMinor: 13_000, addsUp: true });
    const before = await liabilityRows(store, customPeriod("2020-01-01", "2020-01-31"));
    expect(before.find((r) => r.ledger === "bonus")).toMatchObject({ openingMinor: 0, closingMinor: 0, addsUp: true });
  });
});

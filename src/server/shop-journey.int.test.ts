import { randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";

import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { StatementRecord } from "@/db/statement-count";
import type { FeatureId } from "@/lib/store-features";

/**
 * A shop-only store's journey (bloat review step 1.12, GAP-surface-1, GAP-database-s1, GAP-surface-s2): a store with only the online shop
 * on, walked from its frame to the order and the owner's three first screens (`shop-journey-test-support.ts`, one function per stop, each
 * the server calls its page makes). Held in the key `shopJourney` of `src/server/ratchet.baseline.json`:
 *
 * 1. the tables each stop scans (`tables`): a table a stop did not scan before fails with the stop and the table;
 * 2. no stop scans a table of a feature that is off (`FEATURE_TABLES`), but the gift cards on the cart and the checkout (`ALLOWED`) and
 *    what `KNOWN_READS` names with the step that removes it;
 * 3. the frame sends no statement twice with the same values, but what `KNOWN_TWICE` names;
 * 4. eight stops read as many rows with 19 other stores, each with every feature on, as with the store alone, within a small room for
 *    another database's statistics (`rowsGrowth` holds each stop's growth, which only falls); each stop's rows read alone (`rowsRead`) are written
 *    and a change is a note, since which index serves a statement is the database's statistics' choice (`rowsNote()`);
 * 5. the dispatcher's jobs, idle, open no transaction, but those `KNOWN_TRANSACTIONS` names;
 * 6. and each would notice the scratch change it is for.
 *
 * A rise fails and says the fix; with FIRST=1 UPDATE_BASELINE=1 the rise is accepted and shows in the baseline's diff. A fall, a new stop or a
 * new table in the database is a note (lower the baseline with UPDATE_BASELINE=1). Sequential scans are off for the whole database while the
 * file runs (reset after), and hash, merge, bitmap and index-only plans while a stop is measured (`withFixedPlans()`), so a read that no
 * index serves shows as the rows it reads, and what a stop scans is what its statements and the data decide, not the planner's choice.
 * No statement count is kept here: a page's statements have one home, `scripts/server-budget.mjs` (store pages) and
 * `admin-statements.baseline.json` (the admin's screens).
 */

const { jar, pending, network } = vi.hoisted(() => ({
  /** The shopper's cookies: the cart's, set by each stop. */
  jar: new Map<string, string>(),
  pending: [] as (() => unknown)[],
  /** The network, refused, as the query budget refuses it: the jobs and the search never reach out. */
  network: { reached: new Set<string>() },
}));
vi.mock("server-only", () => ({}));
vi.mock("./replicate-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./replicate-fetch")>()),
  safeFetch: async (url: string) => {
    network.reached.add(new URL(url).host);
    return { ok: false as const, problem: "shop journey: no network" };
  },
}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({
  connection: async () => {},
  after: (task: (() => unknown) | Promise<unknown>) => void pending.push(typeof task === "function" ? task : () => task),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers(),
}));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { closeDb, db } = await import("@/db/client");
const { countStatements, sameStatementTwice } = await import("@/db/statement-count");
const { closeSide, idleClock, side } = await import("./query-budget-test-support");
const { measureTables, readKey, writeKey } = await import("./table-stats-test-support");
const { removeSeed, seedStores } = await import("./budget-seed-test-support");
const { DISPATCHER_JOBS } = await import("./dispatcher-jobs");
const { kebab } = await import("./cron-runs");
const { listProducts } = await import("./catalog");
const { getStore } = await import("./stores");
const J = await import("./shop-journey-test-support");

const STOPS = ["frame", "home", "listing", "product", "search", "cart", "checkout", "order", "ownerHome", "adminOrders", "adminProducts"] as const;
type Stop = (typeof STOPS)[number];
/**
 * The stops measured again with 19 other stores (Part 4): the brief's seven reads that could grow with them, and the front page, whose
 * product list is the one `listProducts()` reads (the listing reads `listGridProducts()` and `listing.ts`), so that read is held too.
 */
const GROWTH_STOPS = ["order", "adminOrders", "adminProducts", "product", "listing", "home", "search", "cart"] as const satisfies readonly Stop[];

type Held = {
  tables?: Partial<Record<Stop, string[]>>;
  rowsRead?: Partial<Record<Stop, number>>;
  rowsGrowth?: Partial<Record<Stop, number>>;
  /** Every table of `commerce` when the map below was last looked at: a table not here is new, and a note asks to place it. */
  knownTables?: string[];
};

const WRITE = process.env.UPDATE_BASELINE === "1";
const RAISE = process.env.FIRST === "1";
const FIX = "UPDATE_BASELINE=1 pnpm vitest run --config vitest.integration.config.mts src/server/shop-journey.int.test.ts";
const T = 180_000;

/**
 * The tables of each switchable part of a store, by the code that writes them (read on 17 November 2026, every table of
 * `src/db/schema.ts`): the features of `src/lib/store-features.ts` but the shop itself, and Work, which a store's owner switches on in
 * `stores.modules` (D123) and a shop-only store has off. A table two features share (a booking is an appointment's or a stay's) is listed
 * under both and is off only when both are. Every other table is the shop's, the website's, the platform's or a part with no switch:
 * the blog, the chat agent and its knowledge, experiments, marketing email, SMS, quotes, wishlists and checkout rules (the brief's other
 * prefixes) are always there to set up and are not store features, so they are not here.
 *
 * Unsure, and so left out (each is read by the shop with every feature off, or by more than one part):
 * - market_availability (what is sold where, D335): one market has it too.
 * - customer_tiers (customer groups, D108): a discount group for consumers as well as companies; price lists are the shop's (admin map).
 * - vat_checks (D157): the seller's own number is checked on the tax screen too, not only a buyer's.
 * - checkout_accounts (D32), activities (S3), crm_moves and crm_move_links (Pipedrive, D477), creators and their tables (D386, the shop's
 *   in the admin map), referral_* (Kaizena Flow's own program for owners, D131, not the store's) and contract_seals (the platform's one seal).
 * - languages has no table of its own: product_translations hold the first language's words too; ui_translations are the platform's.
 * - market_price_rules and product_market_texts are placed under countries (a market's prices from another's, a country's own text):
 *   both need a second market, but neither reader asks the feature.
 */
const FEATURE_TABLES: Record<Exclude<FeatureId, "shop"> | "work", readonly string[]> = {
  subscriptions: ["selling_plans", "subscriptions", "subscription_lines"],
  boxes: ["standing_orders", "standing_order_lines", "standing_deliveries", "delivery_schedules"],
  appointments: ["appointment_settings", "product_resources", "booking_resources", "bookings", "resource_blocks", "calendar_feeds"],
  bookings: ["booking_seasons", "booking_resources", "bookings", "resource_blocks", "calendar_feeds", "hosts", "host_commissions", "host_stripe_accounts", "host_tax_details"],
  gift_cards: ["gift_cards", "gift_card_entries", "gift_card_settings", "cart_gift_cards"],
  countries: ["market_price_rules", "product_market_texts"],
  languages: [],
  currencies: ["store_currencies"],
  business: ["customer_companies", "company_locations", "company_location_buyers", "company_invites", "order_payment_terms"],
  bonus: ["bonus_settings", "bonus_entries", "bonus_allocations", "bonus_rewards"],
  referrals: ["affiliate_settings", "affiliates", "affiliate_attributions"],
  reviews: ["product_reviews", "review_pictures", "review_requests", "review_settings"],
  sales: ["deals", "deal_links", "deal_moves", "deal_pipelines", "deal_stages", "lead_decisions", "contracts", "contract_templates", "contract_signers", "contract_events", "contract_codes"],
  projects: ["projects", "project_statuses", "checklists", "project_checklists", "checklist_statuses", "checklist_sections", "checklist_items", "project_item_stages", "checklist_subtasks", "checklist_folds"],
  work: [
    "work_settings",
    "work_clients",
    "work_assignments",
    "work_tasks",
    "work_recurring_invoices",
    "work_invoices",
    "work_invoice_lines",
    "work_time_entries",
    "work_timers",
    "work_invoice_payments",
    "work_invoice_losses",
    "work_credit_notes",
    "work_events",
  ],
};
type Part = keyof typeof FEATURE_TABLES;

/** What a stop may read of a feature that is off: a gift card can be spent in any shop (D300: cards already sold stay usable). */
const ALLOWED: Partial<Record<Stop, Part[]>> = { cart: ["gift_cards"], checkout: ["gift_cards"] };

/** The store's own read (`getStore()`, the frame's, cached in production) takes its extra currencies whether Several currencies is on or not. */
const STORE_READ = "2.18 (the store's own read, getStore(), asks for the extra currencies with Several currencies off)";

/**
 * Tables of switched-off features scanned today (17 November 2026), by stop, with the step that removes the read. Only shrinks: a read that
 * is gone is a note to take it off; a new one fails.
 */
const KNOWN_READS: Partial<Record<Stop, Record<string, string>>> = {
  frame: { store_currencies: STORE_READ },
  home: { store_currencies: STORE_READ },
  listing: { store_currencies: STORE_READ },
  product: {
    store_currencies: STORE_READ,
    hosts: "2.13 (getProduct() asks for a host's name, a stay's or rental's, of every product)",
    product_market_texts: "2.13 (getProduct() asks for a country's own description with Several countries off)",
    selling_plans: "2.13 (getProduct() reads the purchase options with Subscriptions off)",
  },
  search: { store_currencies: STORE_READ },
  cart: {
    store_currencies: STORE_READ,
    appointment_settings: "2.19 (the cart's lines join an appointment's settings, `bookable` in cart.ts, for goods too)",
    booking_resources: "2.19 (the cart's lines join their booked resource, for goods too)",
    selling_plans: "2.19 (the cart's lines join their purchase option with Subscriptions off)",
  },
  checkout: {
    store_currencies: STORE_READ,
    bookings: "2.19 (getOpenCheckout() compares an appointment's time on every line)",
    company_locations: "2.19 (getOrder() reads the company's location with Sell to businesses off)",
    order_payment_terms: "2.19 (getOrder() reads payment terms with Sell to businesses off)",
    subscriptions: "2.19 (getOpenCheckout() joins the order's subscription with Subscriptions off)",
  },
  order: {
    store_currencies: STORE_READ,
    affiliate_settings: "2.48 (placeOrder() asks the referral program with Referrals off)",
    appointment_settings: "2.48 (placeOrder() reads the lines as the cart does, `bookable`)",
    bonus_settings: "2.48 (placeOrder() asks the bonus program with Bonus off)",
    selling_plans: "2.48 (placeOrder() joins the lines' purchase options with Subscriptions off)",
    // The same reason as ALLOWED's (a gift card can be spent in any shop: placeOrder() takes the cards the cart holds); the brief allows the
    // gift cards only on the cart and the checkout, so they wait here for a decision rather than on ALLOWED.
    cart_gift_cards: "none (a gift card can be spent in any shop; ALLOWED names only the cart and the checkout)",
    gift_cards: "none (a gift card can be spent in any shop; ALLOWED names only the cart and the checkout)",
  },
  ownerHome: {
    booking_resources: "2.32 (getSetupProgress() counts staff and rooms with Appointments and Stays off)",
    order_payment_terms: "2.32 (controlCenter() counts payment terms due with Sell to businesses off)",
  },
  adminOrders: { store_currencies: "4.4 (the orders list reads the currencies' rates for its totals, src/server/order-list.ts)" },
};

/** Statements the frame sends twice with the same values today (the first 120 characters), with why. Only shrinks. */
const KNOWN_TWICE: Record<string, string> = {};

/** Dispatcher jobs that open a transaction with nothing to do, with why. Only shrinks. */
const KNOWN_TRANSACTIONS: Record<string, string> = {
  // One run at a time: an advisory lock taken inside a transaction before anything is read (syncHouseCustomers()).
  "dispatcher.house-customers": "takes pg_try_advisory_xact_lock before it looks for work",
  // publishOne() claims a due publish inside its transaction, so an idle run opens one to find none (runSchedules()).
  "dispatcher.schedules": "claims the next due publish inside a transaction",
};

/**
 * What the eight stops read more with the 19 other stores today (17 November 2026), held in shopJourney.rowsGrowth (only falls), with the
 * step that fixes each. The other six read the same rows.
 */
const GROWTH_STEPS: Partial<Record<Stop, string>> = {
  // aiFor() (src/server/ai.ts, reached by searchProducts()'s aiAbilities()) reads `enabled and (store_id is null or store_id = …)`, which no
  // index of the store serves: every store's AI row, 19 here, one a store. No step names it yet.
  search: "none yet (aiFor() reads every store's AI row: 19 rows, one a store)",
  // Not other stores': the order is placed last with the others there and first without, so the store has two orders more by then, and
  // placeOrder() reads the store's own earlier orders and holds (10 and 3 rows more). Step 2.48 holds an order's statements against earlier orders.
  order: "2.48 (13 rows: the store's own two earlier orders and their holds, not other stores')",
};

const short = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 120);
const roomOf = (held: number) => Math.max(50, Math.round(held * 0.1));
/**
 * The room a stop's growth with 19 other stores has. With the plans fixed (`withFixedPlans()`) the growth repeats exactly on one database;
 * the room is for another database, whose statistics may pick another index. A read that fetches one row of each other store adds 19.
 */
const growthRoomOf = (held: number) => Math.max(5, Math.round(held * 0.05));

/** A recorded statement as it was sent, to send again (or changed) through the app's pool. */
function resend(text: string, values: unknown[]): SQL {
  const parts = text.split(/\$(\d+)/);
  return sql.join(parts.map((part, i) => (i % 2 === 0 ? sql.raw(part) : sql`${values[Number(part) - 1]}`)));
}

/** The parts that are off for this store: every feature but the ones on, and Work unless it is on. */
function offParts(store: { features: readonly string[]; workOn: boolean }): Set<Part> {
  const on = new Set(store.features);
  return new Set((Object.keys(FEATURE_TABLES) as Part[]).filter((part) => (part === "work" ? !store.workOn : !on.has(part))));
}

/** The tables of a stop's scans that belong only to parts that are off and the stop may not read, each with its parts. */
function offReads(stop: Stop, scanned: readonly string[], off: Set<Part>): { table: string; parts: Part[] }[] {
  const allowed = new Set((ALLOWED[stop] ?? []).flatMap((part) => FEATURE_TABLES[part]));
  return scanned.flatMap((table) => {
    const parts = (Object.keys(FEATURE_TABLES) as Part[]).filter((part) => FEATURE_TABLES[part].includes(table));
    return parts.length > 0 && parts.every((part) => off.has(part)) && !allowed.has(table) ? [{ table, parts }] : [];
  });
}

/** Part 2's rule for one stop: what it reads of switched-off parts that `KNOWN_READS` does not name; notes what it names and no longer reads. */
function featureProblems(stop: Stop, scanned: readonly string[], off: Set<Part>): string[] {
  const known = KNOWN_READS[stop] ?? {};
  const reads = offReads(stop, scanned, off);
  for (const table of Object.keys(known)) {
    if (!reads.some((r) => r.table === table)) console.warn(`shop journey: ${stop} no longer reads commerce.${table}: take it off KNOWN_READS`);
  }
  return reads
    .filter((r) => !(r.table in known))
    .map((r) => `${stop} reads commerce.${r.table}, a table of ${r.parts.join(" and ")}, which is off in a shop-only store: read it only while the feature is on (featureOn(store, ...))`);
}

/** Part 1's rule: a table scanned that the stop's list does not hold fails; one held and no longer scanned is a note. */
function tableProblems(stop: Stop, scanned: readonly string[], held: readonly string[] | undefined): string[] {
  if (!held) {
    console.warn(`shop journey: ${stop} is not in the baseline yet (${scanned.length} tables); add it with FIRST=1 ${FIX}`);
    return [];
  }
  for (const table of held) if (!scanned.includes(table)) console.warn(`shop journey: ${stop} no longer scans commerce.${table}: lower the baseline with ${FIX}`);
  return scanned
    .filter((table) => !held.includes(table))
    .map((table) => `${stop} now scans commerce.${table}, which its list in shopJourney.tables does not hold: read less, or accept it with FIRST=1 ${FIX} and say why in the commit message`);
}

/**
 * Rows read alone are written and compared as a note, not held: which index the planner takes for a statement follows the database's own
 * statistics, so the same stop reads another number of rows on another database (the cart read 170 rows on a fresh one and 433 where five
 * other integration files had run first, in the same 24 scans). On one database the figures repeat exactly (four runs, table by table).
 * What is held of rows is what one database can say: the growth with 19 other stores (Part 4).
 */
function rowsNote(stop: Stop, rows: number, held: number | undefined): void {
  if (held === undefined) return;
  if (rows > held + roomOf(held)) console.warn(`shop journey: ${stop} now reads ${rows} rows, baseline ${held} (a note: rows read follow the database's statistics; the growth is held)`);
  if (rows < held - roomOf(held)) console.warn(`shop journey: ${stop} now reads ${rows} rows, baseline ${held}: lower the baseline with ${FIX}`);
}

/** Part 5's rule: the jobs that sent a begin. */
const opensTransaction = (records: StatementRecord[]) => records.some((r) => r.control && r.text.trim().toLowerCase().startsWith("begin"));

/** Part 3's rule: statements the frame sent twice that `KNOWN_TWICE` does not name. */
function twiceProblems(records: StatementRecord[]): string[] {
  const twice = sameStatementTwice(records).map(short);
  for (const text of Object.keys(KNOWN_TWICE)) if (!twice.includes(text)) console.warn(`shop journey: the frame no longer sends twice: ${text}; take it off KNOWN_TWICE`);
  return twice.filter((text) => !(text in KNOWN_TWICE)).map((text) => `the frame sends this twice with the same values: ${text}`);
}

// The store and what the stops need of it.
const RUN = "sj";
const RUN_OTHERS = "sj20";
let store: { id: string; slug: string; market: string; member: Awaited<ReturnType<typeof seedStores>>["stores"][number]["member"] };
let marketOf: NonNullable<Awaited<ReturnType<typeof getStore>>>["markets"][number];
let off: Set<Part>;
const SKUS = ["PRODUCT-1", "PRODUCT-2", "PRODUCT-3"];
let browsingCart = "";
let checkoutCart = "";

const cartCookie = () => `cart_${store.id}_${marketOf.code.toLowerCase()}`;

/** A guest's open cart in the market holding one of each SKU. */
async function newCart(): Promise<string> {
  const [cart] = await db().execute<{ id: string }>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
    values (${store.id}::uuid, ${marketOf.code}, ${marketOf.currency}, ${marketOf.locale}, now() + interval '1 day') returning id
  `);
  await db().execute(sql`
    insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
    select ${store.id}::uuid, ${cart.id}::uuid, id, 1 from commerce.product_variants where store_id = ${store.id}::uuid and sku in (${sql.join(SKUS.map((s) => sql`${s}`), sql`, `)})
  `);
  return String(cart.id);
}

/** A visitor with no cart: the stops before the cart are a first visit's. */
const noCart = () => {
  jar.clear();
};

/** Each stop, ready to run: the cart stops set the cookie, the order stop places a fresh cart each time. */
const RUNS: Record<Stop, () => Promise<() => Promise<unknown>>> = {
  frame: async () => (noCart(), () => J.frame(store.slug, store.market)),
  home: async () => (noCart(), () => J.home(store.slug, store.market)),
  listing: async () => (noCart(), () => J.listing(store.slug, store.market)),
  product: async () => (noCart(), () => J.product(store.slug, store.market, "product-1")),
  search: async () => (noCart(), () => J.search(store.slug, store.market, "product")),
  cart: async () => {
    jar.set(cartCookie(), browsingCart);
    return () => J.cart(store.slug, store.market);
  },
  checkout: async () => {
    jar.set(cartCookie(), checkoutCart);
    return () => J.checkout(store.slug, store.market);
  },
  order: async () => {
    noCart();
    const cartId = await newCart();
    return () => J.order({ storeId: store.id, market: marketOf }, cartId);
  },
  ownerHome: async () => (noCart(), () => J.ownerHome(store.member)),
  adminOrders: async () => (noCart(), () => J.adminOrders(store.member)),
  adminProducts: async () => (noCart(), () => J.adminProducts(store.member)),
};

type Measured = { tables: string[]; rowsRead: number; records: StatementRecord[] };

/** A stop run once to warm what is kept per process, then measured: the tables whose scans moved, the rows read, what was sent. */
async function measureStop(stop: Stop, extra?: () => Promise<unknown>): Promise<Measured> {
  try {
    await (await RUNS[stop])();
    await drain();
  } catch (error) {
    throw new Error(`${stop} threw on its first run: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const run = await RUNS[stop]();
  const m = await withFixedPlans(() =>
    measureTables(async () => {
      await run();
      await drain();
      await extra?.();
    }),
  );
  const entries = Object.entries(m.tables);
  return {
    tables: entries.filter(([, t]) => t.scans > 0).map(([name]) => name).sort(),
    rowsRead: entries.reduce((sum, [, t]) => sum + t.rowsRead, 0),
    records: m.records,
  };
}

async function drain(): Promise<void> {
  while (pending.length > 0) await pending.shift()!();
}

const measured: { tables: Partial<Record<Stop, string[]>>; rowsRead: Partial<Record<Stop, number>>; growth: Partial<Record<Stop, number>> } = { tables: {}, rowsRead: {}, growth: {} };
const records: Partial<Record<Stop, StatementRecord[]>> = {};
const held = (): Held => readKey<Held>("shopJourney") ?? {};

/**
 * A setting for every new connection to this database (null resets it). Sequential scans are off while the file runs, as the brief asks.
 * While a stop is measured the plans that make what a statement touches the planner's choice rather than the data's are off too: a hash
 * join scans its inner table whole, or not at all when the outer side is empty, and an index-only or bitmap scan counts its rows another way,
 * so with them on a stop's tables and rows moved between runs on the same database (the cart scanned booking_resources in one run of three,
 * the store Home order_lines in two; the statistics of the random keys differ with each seed). With them off every read is an index lookup
 * per row, and what a stop scans and reads is what its statements and the data decide: two runs gave the same figures, table by table.
 * Only while measuring: with them off for the whole file the seeding and the jobs took nine minutes instead of one.
 */
async function setForDatabase(setting: string, value: "off" | null): Promise<void> {
  const change = value === null ? `reset ${setting}` : `set ${setting} = ${value}`;
  await side().unsafe(`do $$ begin execute 'alter database ' || quote_ident(current_database()) || ' ${change}'; end $$`);
}
const FIXED_PLANS = ["enable_hashjoin", "enable_mergejoin", "enable_bitmapscan", "enable_indexonlyscan"] as const;

/** Runs `measure` with the plans fixed; the app's pool reconnects with them (`settled()` closes it first) and after, without them. */
async function withFixedPlans<T>(measure: () => Promise<T>): Promise<T> {
  for (const setting of FIXED_PLANS) await setForDatabase(setting, "off");
  try {
    return await measure();
  } finally {
    for (const setting of FIXED_PLANS) await setForDatabase(setting, null);
    await closeDb();
  }
}

const realFetch = globalThis.fetch;
const originals: (() => unknown)[] = [];

beforeAll(async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    network.reached.add(url.host);
    throw new Error(`shop journey: no network (${url.host})`);
  }) as typeof fetch;
  for (const mod of [http, https] as unknown as Record<string, (...args: unknown[]) => unknown>[]) {
    for (const fn of ["request", "get"]) {
      const original = mod[fn];
      originals.push(() => (mod[fn] = original));
      mod[fn] = (...args: unknown[]) => {
        const first = args[0] as string | URL | { hostname?: string; host?: string };
        const host = typeof first === "string" || first instanceof URL ? new URL(first).host : (first.hostname ?? first.host ?? "");
        network.reached.add(host);
        throw new Error(`shop journey: no network (${host})`);
      };
    }
  }
  syncBuiltinESMExports();
  // What an earlier run left, if it stopped half way, goes first. A fixed run: some reads fetch by the names the seed writes.
  await removeSeed(RUN);
  await removeSeed(RUN_OTHERS);
  const { stores } = await seedStores({ count: 1, features: "shop", run: RUN });
  const made = stores[0];
  // A Stripe account in test mode, as an open store selling has (its checkout's order waits for payment on it).
  await db().execute(sql`
    insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
    values (${made.id}::uuid, 'test', ${`acct_${RUN}${randomBytes(4).toString("hex")}`}, 'active', false)
  `);
  const fresh = (await getStore(made.slug))!;
  marketOf = fresh.markets[0];
  store = { id: made.id, slug: made.slug, market: marketOf.slug, member: { ...made.member, store: fresh } };
  off = offParts(fresh);
  browsingCart = await newCart();
  // The checkout's cart: its order placed and its payment started, as the cart's checkout button leaves it (`startPayment()` writes the
  // payment row Stripe's session answers; no session is asked of Stripe here).
  checkoutCart = await newCart();
  await J.order({ storeId: store.id, market: marketOf }, checkoutCart);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, client_secret, amount_minor, currency, status)
    select o.store_id, o.id, 'stripe', ${`cs_test_${randomBytes(6).toString("hex")}`}, a.account_id, 'pi_journey_secret_test', o.total_minor, o.currency, 'pending'
    from commerce.orders o join commerce.stripe_accounts a on a.store_id = o.store_id
    where o.store_id = ${store.id}::uuid and o.cart_id = ${checkoutCart}::uuid
  `);
  // Autovacuum kept away for the file, as the query budget does: coming by in the middle it turns an index scan into an index-only one, and
  // the rows read move with when it came. Then every table packed and analysed: an earlier run's deleted rows leave an index a page larger,
  // and the planner, which weighs a scan by its pages, then reads a store's rows through another index (product_variants read 416 rows
  // or 47,588 by that alone). Then sequential scans off for every new connection to this database.
  for (const { tablename } of await side()`select tablename from pg_tables where schemaname = 'commerce'`) {
    await side().unsafe(`alter table commerce."${String(tablename)}" set (autovacuum_enabled = false)`);
  }
  await side()`vacuum full analyze`;
  await setForDatabase("enable_seqscan", "off");
  await closeDb();
}, 600_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  for (const restore of originals) restore();
  syncBuiltinESMExports();
  vi.useRealTimers();
  try {
    if (WRITE) write();
  } finally {
    for (const setting of ["enable_seqscan", ...FIXED_PLANS]) await setForDatabase(setting, null);
    await closeDb();
    for (const { tablename } of await side()`select tablename from pg_tables where schemaname = 'commerce'`) {
      await side().unsafe(`alter table commerce."${String(tablename)}" reset (autovacuum_enabled)`);
    }
    await removeSeed(RUN);
    await removeSeed(RUN_OTHERS);
    await closeDb();
    await closeSide();
  }
}, 600_000);

/** Writes what this run measured over the baseline; a rise (a table more, more rows, more growth) only with FIRST=1. */
async function knownTables(): Promise<string[]> {
  return (await side()`select tablename from pg_tables where schemaname = 'commerce' order by 1`).map((r) => String(r.tablename));
}
let tablesNow: string[] = [];

function write(): void {
  const before = held();
  const rose: string[] = [];
  for (const [stop, list] of Object.entries(measured.tables) as [Stop, string[]][]) {
    const was = before.tables?.[stop];
    if (was && list.some((t) => !was.includes(t))) rose.push(`${stop}'s tables`);
  }
  for (const [stop, growth] of Object.entries(measured.growth) as [Stop, number][]) {
    const was = before.rowsGrowth?.[stop] ?? 0;
    if (growth > was + growthRoomOf(was)) rose.push(`${stop}'s growth`);
  }
  if (rose.length > 0 && !RAISE) throw new Error(`Not written: ${rose.join(", ")} rose; with FIRST=1 the rise is accepted.`);
  const sorted = <V>(o: Partial<Record<Stop, V>>) => Object.fromEntries(STOPS.filter((s) => o[s] !== undefined).map((s) => [s, o[s]]));
  writeKey("shopJourney", {
    tables: sorted({ ...before.tables, ...measured.tables }),
    rowsRead: sorted({ ...before.rowsRead, ...measured.rowsRead }),
    // The growth of each of the eight stops when Part 4 ran (a fall below nothing is nothing), else kept.
    rowsGrowth: part4Ran ? sorted(Object.fromEntries(Object.entries(measured.growth).map(([stop, n]) => [stop, Math.max(0, n)]))) : (before.rowsGrowth ?? {}),
    knownTables: tablesNow.length > 0 ? tablesNow : (before.knownTables ?? []),
  } satisfies Held);
}
let part4Ran = false;

describe("a shop-only store's journey", () => {
  it("is a store with only the shop on, and the map knows every table it names", async () => {
    expect(store.member.store.features).toEqual(["shop"]);
    expect(store.member.store.workOn).toBe(false);
    tablesNow = await knownTables();
    const named = [...new Set(Object.values(FEATURE_TABLES).flat())];
    expect(named.filter((t) => !tablesNow.includes(t)), "tables in FEATURE_TABLES that the database does not have: take them off").toEqual([]);
    const known = held().knownTables;
    const fresh = known ? tablesNow.filter((t) => !known.includes(t)) : [];
    if (fresh.length > 0) {
      console.warn(`shop journey: new tables ${fresh.join(", ")}: place each in FEATURE_TABLES if a switch of a store owns it, then ${FIX}`);
    }
  }, T);

  describe("Part 1 and 2: the tables each stop scans, and none of a feature that is off", () => {
    for (const stop of STOPS) {
      it(stop, async () => {
        const m = await measureStop(stop);
        measured.tables[stop] = m.tables;
        measured.rowsRead[stop] = m.rowsRead;
        records[stop] = m.records;
        console.info(`shop journey: ${stop} scans ${m.tables.length} tables and reads ${m.rowsRead} rows: ${m.tables.join(", ")}`);
        if (WRITE) return;
        const before = held();
        rowsNote(stop, m.rowsRead, before.rowsRead?.[stop]);
        const problems = [
          ...tableProblems(stop, m.tables, before.tables?.[stop]),
          ...featureProblems(stop, m.tables, off),
        ];
        expect(problems).toEqual([]);
      }, T);
    }
  });

  it("Part 2 (in the baseline too): no stop's list holds a table of a switched-off feature that KNOWN_READS does not name", () => {
    const lists = held().tables ?? {};
    const problems = (Object.entries(lists) as [Stop, string[]][]).flatMap(([stop, list]) =>
      offReads(stop, list, off)
        .filter((r) => !(r.table in (KNOWN_READS[stop] ?? {})))
        .map((r) => `${stop}'s list holds commerce.${r.table} (${r.parts.join(", ")})`),
    );
    expect(problems).toEqual([]);
  });

  it("Part 3: the frame sends no statement twice with the same values", () => {
    expect(records.frame, "the frame was measured").toBeDefined();
    expect(twiceProblems(records.frame!)).toEqual([]);
  });

  describe("Part 5: the dispatcher's jobs, idle, open no transaction", () => {
    // Before the 19 other stores: only the shop-only store and what the database had, at the query budget's quiet hour, with no network.
    beforeAll(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(idleClock());
    });
    afterAll(() => {
      vi.useRealTimers();
    });
    for (const key of Object.keys(DISPATCHER_JOBS) as (keyof typeof DISPATCHER_JOBS)[]) {
      const name = `dispatcher.${kebab(key)}`;
      it(name, async () => {
        // The first run does what was due (a job catches up once); the second is the idle one.
        for (const pass of ["first", "second"]) {
          try {
            const { statements } = await countStatements<unknown>(() => DISPATCHER_JOBS[key]());
            if (pass === "first") continue;
            const opens = opensTransaction(statements);
            if (name in KNOWN_TRANSACTIONS) {
              if (!opens) console.warn(`shop journey: ${name} no longer opens a transaction when idle: take it off KNOWN_TRANSACTIONS`);
            } else {
              expect(opens, `${name} opens a transaction with nothing to do: ask whether anything is due first, outside one`).toBe(false);
            }
          } catch (error) {
            if (error instanceof Error && error.message.includes("opens a transaction")) throw error;
            throw new Error(`${name} threw on its ${pass} run: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
          }
        }
      }, T);
    }
  });

  describe("Part 4: rows read with 19 other stores", () => {
    // Each stop measured alone, then again once 19 stores with every feature on are there, in an order that leaves the store as it was:
    // the order comes first alone and last with the others, so the orders list counts the same orders both times.
    const alone: Partial<Record<Stop, number>> = {};
    const unfiltered: { alone?: number; others?: number } = {};
    const listProductsCopy = async () => {
      const { statements } = await countStatements(() => listProducts(store.id, marketOf));
      const read = statements.find((r) => /from commerce\.products p\b/.test(r.text) && /p\.store_id = \$\d+::uuid and /.test(r.text));
      if (!read) throw new Error("listProducts' read of the store's products (`where p.store_id = … and …`) was not found: its store filter is gone, or Part 6 (c) needs the new wording");
      // Part 6 (c): the same read without its store's filter.
      return resend(read.text.replace(/p\.store_id = \$\d+::uuid and /, ""), read.values);
    };

    it("measures the eight stops, the store alone", async () => {
      for (const stop of GROWTH_STOPS) alone[stop] = (await measureStop(stop)).rowsRead;
    }, T * 2);

    it("measures listProducts' read without its store filter, the store alone", async () => {
      const copy = await listProductsCopy();
      const m = await measureTables(() => db().execute(copy));
      unfiltered.alone = Object.values(m.tables).reduce((sum, t) => sum + t.rowsRead, 0);
    }, T);

    it("seeds 19 stores with every feature on", async () => {
      await seedStores({ count: 19, features: "all", run: RUN_OTHERS });
      // Neither vacuumed nor analysed: a vacuum would make pages the stops read all-visible, and new statistics would let the planner choose
      // other plans, and each moves the rows read for that alone. With the statistics the store alone had, what grows is what is read.
    }, 900_000);

    it("reads as many rows with the 19 stores for each stop, within its room (rowsGrowth holds those that do not)", async () => {
      part4Ran = true;
      const growth = [...GROWTH_STOPS.filter((s) => s !== "order"), "order" as const];
      for (const stop of growth) {
        const now = (await measureStop(stop)).rowsRead;
        measured.growth[stop] = now - alone[stop]!;
      }
      console.info(`shop journey: growth with 19 stores ${JSON.stringify(measured.growth)}`);
      if (WRITE) return;
      const before = held().rowsGrowth ?? {};
      const problems = GROWTH_STOPS.flatMap((stop) => {
        const now = measured.growth[stop]!;
        const was = before[stop] ?? 0;
        if (now < was - growthRoomOf(was)) console.warn(`shop journey: ${stop}'s growth with 19 stores is now ${now} rows, baseline ${was}: lower the baseline with ${FIX}`);
        return now > was + growthRoomOf(was)
          ? [`${stop} reads ${now} more rows with 19 other stores (baseline ${was}${GROWTH_STEPS[stop] ? `, to be fixed by step ${GROWTH_STEPS[stop]}` : ""}): a read that no index of the store's own serves; filter it with owned(storeId), or accept it with FIRST=1 ${FIX}`]
          : [];
      });
      expect(problems).toEqual([]);
    }, T * 3);

    it("would notice (c): listProducts' read without its store filter reads more rows with the other stores", async () => {
      expect(unfiltered.alone, "the read was measured with the store alone").toBeDefined();
      const copy = await listProductsCopy();
      const m = await measureTables(() => db().execute(copy));
      unfiltered.others = Object.values(m.tables).reduce((sum, t) => sum + t.rowsRead, 0);
      expect(unfiltered.others).toBeGreaterThan(unfiltered.alone! + 19 * 100);
    }, T);
  });

  describe("Part 6: each would notice its scratch change", () => {
    it("(a) a read of commerce.bonus_settings beside the cart breaks Part 2's rule", async () => {
      const m = await measureStop("cart", () => db().execute(sql`select 1 from commerce.bonus_settings where store_id = ${store.id}::uuid`));
      expect(m.tables).toContain("bonus_settings");
      expect(featureProblems("cart", m.tables, off).some((p) => p.includes("commerce.bonus_settings"))).toBe(true);
    }, T);

    it("(b) a read of commerce.checkout_rules beside the checkout adds a table to its list", async () => {
      const list = held().tables?.checkout ?? measured.tables.checkout!;
      expect(list, "checkout_rules is already on the checkout's list: this case needs another table").not.toContain("checkout_rules");
      const m = await measureStop("checkout", () => db().execute(sql`select 1 from commerce.checkout_rules where store_id = ${store.id}::uuid`));
      expect(tableProblems("checkout", m.tables, list).some((p) => p.includes("commerce.checkout_rules"))).toBe(true);
    }, T);

    it("(d) a second slug lookup in the frame is a statement sent twice", async () => {
      const lookup = records.frame?.find((r) => !r.control && /from commerce\.stores\b/.test(r.text) && r.values.includes(store.slug));
      expect(lookup, "the frame's store lookup by its slug").toBeDefined();
      const { statements } = await countStatements(async () => {
        await J.frame(store.slug, store.market);
        await db().execute(resend(lookup!.text, lookup!.values));
      });
      expect(twiceProblems(statements).some((p) => p.includes(short(lookup!.text)))).toBe(true);
    }, T);

    it("(e) an idle job that opens a transaction is seen", async () => {
      const { statements } = await countStatements(async () => {
        await DISPATCHER_JOBS.trials();
        await db().transaction(async (tx) => tx.execute(sql`select 1`));
      });
      expect(opensTransaction(statements)).toBe(true);
    }, T);
  });
});

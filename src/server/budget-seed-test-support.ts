import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { FEATURE_IDS } from "@/lib/store-features";
import { sealFikenState } from "@/lib/fiken";
import { parseKey } from "@/lib/secret-box";

import type { Membership } from "./auth";
import { seedContent } from "./budget-content-fixture";
import { makeCapacityStore } from "./capacity-test-support";
import { fakeFiken } from "./fiken-test-support";
import { side } from "./query-budget-test-support";
import { getStore } from "./stores";
import { fakeTripletex } from "./tripletex-test-support";

/**
 * Stores for the budgets that count per store (bloat review steps 1.10 and 1.12): open stores with pages and products made by set-based SQL,
 * and with 'all' every per-store feature a scheduled job looks at switched on through the feature's own server function (the one its admin
 * action calls), so an encrypted column holds what the app can read. Tripletex, Fiken and eBay are connected against their stand-ins (the
 * tests' fakes answer the connect), and the ad connection needs no answer. No order, document, conversation or send is due; what the
 * content itself brings is (the chat agents' knowledge of the new pages). The name ends in test-support.ts, so the code ratchet does not
 * count it; the rows of pages and products are in `budget-content-fixture.ts`.
 */

/**
 * What 'all' switches on, by name. A store keeps its books in one system (D460: Fiken is refused while Tripletex is connected, and the other
 * way round), so the odd stores (1, 3, …) connect Tripletex and the even ones Fiken; every other feature is on in every store.
 */
export const SEEDED_FEATURES = [
  "chat agent",
  "AI key of its own",
  "picture model",
  "open books",
  "Tripletex",
  "Fiken",
  "eBay",
  "auto-archive",
  "AI budget",
  "repeating Work invoice",
  "welcome email",
  "win-back email",
  "ad connection",
  "support inbox",
] as const;

export type SeededStore = { id: string; slug: string; owner: string; email: string; member: Membership };

const pad = (n: number, width: number) => String(n).padStart(width, "0");
/** A number from the run's name, for the business numbers and company ids that must differ between runs. */
const runNumber = (run: string) => [...run].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) % 9_000, 0);

/**
 * `count` open stores named budget-<run>-<n> (a random run unless one is given; a test that holds rows read gives a fixed one, since the
 * names it writes move what some reads fetch), each with `pages` published pages and `products` active products with one variant and a
 * price, and the demo content a new store gets.
 */
export async function seedStores(options: { count: number; pages?: number; products?: number; features: "shop" | "all"; run?: string }): Promise<{ run: string; stores: SeededStore[] }> {
  const { count, pages = 30, products = 200, features } = options;
  const run = options.run ?? randomBytes(3).toString("hex");
  const stores: SeededStore[] = [];
  for (let n = 1; n <= count; n++) {
    const made = await makeCapacityStore("budget", `${run}-${n}`);
    const slug = `budget-${run}-${n}`;
    // A Norwegian business, as Tripletex, Fiken and the ledger's chart need one (business details, no secret).
    const org = `9${pad(runNumber(run) * 100 + n, 8)}`;
    await db().execute(sql`
      update commerce.stores set slug = ${slug}, name = ${slug}, status = 'active', setup_completed_at = now(),
        features = ${features === "shop" ? sql`array['shop']` : sql`array[${sql.join(FEATURE_IDS.map((f) => sql`${f}`), sql`, `)}]::text[]`},
        legal_name = ${`Budget ${n} AS`}, organisation_number = ${org}, postal_address = 'Storgata 1, 0150 Oslo', country = 'NO',
        contact_email = ${made.email}${features === "all" ? sql`, modules = array['work']` : sql``}
      where id = ${made.id}::uuid
    `);
    await seedContent(made.id, pages, products);
    const store = (await getStore(slug))!;
    const member: Membership = { account: { id: made.owner, email: made.email, name: "Kari", platformAdmin: false }, store, role: "owner" };
    if (features === "all") await switchEverythingOn(member, run, n, org);
    stores.push({ id: made.id, slug, owner: made.owner, email: made.email, member });
  }
  return { run, stores };
}

/** Every per-store feature in SEEDED_FEATURES, each through the server function its admin action calls. */
async function switchEverythingOn(member: Membership, run: string, n: number, org: string): Promise<void> {
  const storeId = member.store.id;
  const accountId = member.account.id;
  const fail = (feature: string, problem: unknown) => {
    throw new Error(`seedStores could not switch on ${feature}: ${JSON.stringify(problem)}`);
  };
  const { saveChatAgent } = await import("./chat-agent");
  const agent = await saveChatAgent(member.account, storeId, { enabled: true, name: "Ada", occupation: "", avatar: null, greeting: {}, instructions: "", voice: false, dailyLimit: 200 });
  if (!agent.ok) fail("chat agent", agent);

  // The store's own AI key, with a model that sees pictures and one that makes them (D73, D92, D163): a dummy key, encrypted by the saver.
  const { saveAiSettings } = await import("./ai");
  const ai = await saveAiSettings(accountId, storeId, {
    provider: "openai",
    apiKey: `sk-budget-${run}-${n}-0123456789abcdef`,
    embeddingModel: "text-embedding-3-small",
    textModel: "gpt-4.1-mini",
    visionModel: "gpt-4.1-mini",
    imageModel: "gpt-image-1",
    minSimilarity: 0.3,
    embeddingEuOnly: false,
    textEuOnly: false,
    zeroDataRetention: false,
    enabled: true,
  });
  if (!ai.ok) fail("AI key of its own", ai);

  const { openLedgerBook } = await import("./ledger");
  const book = await openLedgerBook(member, new Date().toISOString().slice(0, 10));
  if (!book.ok) fail("open books", book);

  if (n % 2 === 1) {
    const { connectTripletex, startTripletex } = await import("./tripletex");
    const companyId = 900_000 + runNumber(run) * 10 + n;
    const tx = fakeTripletex({ companyId, organizationNumber: org });
    const token = ["test-tlxr", `eyJhbGciOiJIUzI1NiJ9.${companyId}.signature0123456789`].join("_");
    tx.apiTokens.add(token);
    const connected = await connectTripletex(accountId, storeId, token, { fetch: tx.fetch });
    if (!connected.ok) fail("Tripletex", connected);
    const started = await startTripletex(accountId, storeId);
    if (!started.ok) fail("Tripletex", started);
  } else {
    const { finishFikenConnect, startFiken } = await import("./fiken");
    const fk = fakeFiken({ companies: [{ slug: `budget-${run}-${n}`, name: `Budget ${n} AS`, organizationNumber: org, hasApiAccess: true, testCompany: false }] });
    const deps = { fetch: fk.fetch, app: () => ({ clientId: fk.clientId, clientSecret: fk.clientSecret }), sleep: async () => {} };
    const { code, verifier } = fk.issueCode();
    const state = randomBytes(36).toString("base64url");
    const cookie = sealFikenState(parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!, { state, store: member.store.slug, account: accountId, verifier });
    const back = await finishFikenConnect(new URLSearchParams({ code, state }), cookie, { ...deps, owner: async () => member });
    if (!back.endsWith("fiken=connected")) fail("Fiken", back);
    const started = await startFiken(accountId, storeId);
    if (!started.ok) fail("Fiken", started);
  }

  // eBay (D555) through its consent page and back, against a stand-in for the token endpoint.
  const ebay = await import("./ebay");
  const ebayApp = { clientId: "KaizenaF-app-PRD-1234", clientSecret: "PRD-secret-5678", ruName: "Kaizena_Flow-KaizenaF-app-abcdef" };
  const ebayFetch = (async (input: string | URL | Request) => {
    if (String(input).endsWith("/identity/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: `access-${run}-${n}`, expires_in: 7200, refresh_token: `refresh-${run}-${n}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const start = await ebay.startEbayConnect(member, { fetch: ebayFetch, app: ebayApp });
  if (!start.ok) fail("eBay", start);
  else {
    const state = new URL(start.url).searchParams.get("state")!;
    const back = await ebay.finishEbayConnect(new URLSearchParams({ state, code: `code-${run}-${n}` }), start.cookie, { fetch: ebayFetch, app: ebayApp, owner: async () => member });
    if (!back.endsWith("ebay=connected")) fail("eBay", back);
  }

  const { saveOrderSettings } = await import("./order-settings");
  const archive = await saveOrderSettings(member, { autoArchiveDays: 30 });
  if (!archive.ok) fail("auto-archive", archive);

  const { saveAutonomy } = await import("./autopilot-settings");
  await saveAutonomy({ account: member.account, store: member.store }, { budgets: { aiMonthlyUsd: 5 } });

  // A repeating Work invoice whose first date is 30 days away, for a client of the store's own.
  const { createClient } = await import("./work");
  const client = await createClient(member, {
    name: "Kunde AS",
    country: "NO",
    billingAddress: { line1: "Kirkeveien 1", postalCode: "0364", city: "Oslo" },
    billingEmail: "faktura@kunde.no",
    locale: "nb-NO",
    currency: "NOK",
  });
  if (!client.ok) fail("repeating Work invoice", client);
  const { createRecurring } = await import("./work-recurring");
  const startDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const recurring = await createRecurring(member, {
    clientId: client.ok ? client.id : "",
    name: "Retainer",
    description: "Monthly retainer",
    unit: "unit",
    quantityHundredths: 100,
    unitPriceMinor: 950_000,
    discountBp: 0,
    vatCategory: "standard",
    currency: "NOK",
    recurrenceInterval: 1,
    recurrencePeriod: "month",
    startDate,
    endDate: null,
    paymentDays: null,
    autoIssue: false,
    isActive: true,
  });
  if (!recurring.ok) fail("repeating Work invoice", recurring);

  // Two email automations on, with nobody enrolled (the store has no subscriber).
  const { saveAutomation, switchAutomation } = await import("./automations");
  const content = Object.fromEntries(member.store.localization.locales.map((locale) => [locale, { subject: "Hei", preview: "", blocks: [{ type: "paragraph", text: "Hei" }] }]));
  for (const [kind, delayDays] of [["welcome", 1], ["win_back", 90]] as const) {
    const saved = await saveAutomation(member.store, accountId, kind, { delayDays, content });
    if (!saved.ok) fail(`${kind} email`, saved);
    const on = await switchAutomation(member.store, accountId, kind, true);
    if (!on.ok) fail(`${kind} email`, on);
  }

  const { saveAdConnection } = await import("./ad-connections");
  const ad = await saveAdConnection(storeId, accountId, { platform: "meta", accountId: `10000${pad(n, 4)}`, token: `budget-token-${run}-${n}`, dataLevel: "standard", testCode: "", on: true });
  if (!ad.ok) fail("ad connection", ad);

  // The support desk, and the address its emails come in at (the settings page makes it on first look).
  const { ensureDesk } = await import("./support");
  const { deskEmailAddress } = await import("./support-inbound");
  const { memberDesk } = await import("./support-desk");
  const { desk } = memberDesk(member);
  await ensureDesk(desk);
  const address = await deskEmailAddress(desk, { SUPPORT_INBOUND_DOMAIN: "support.example.com" });
  if (!address) fail("support inbox", address);
}

/**
 * Deletes what seedStores made for `run`: every row of the stores (with the database's rules off for that one connection, since issued
 * documents and their trails cannot be deleted otherwise), their owners, their applications, and the customers Kaizena Flow's own store
 * keeps for them.
 */
export async function removeSeed(run: string): Promise<void> {
  const q = side();
  const stores = await q<{ id: string }[]>`select id from commerce.stores where slug like ${`budget-${run}-%`}`;
  const emails = `capacity-budget-${run}-%@example.com`;
  const tables = await q<{ table_name: string }[]>`
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'commerce' and c.column_name = 'store_id' order by 1
  `;
  await q.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    for (const { id } of stores) {
      for (const { table_name } of tables) await tx.unsafe(`delete from commerce."${table_name}" where store_id = $1`, [id]);
      await tx`delete from commerce.stores where id = ${id}::uuid`;
    }
  });
  // With the rules on again, so what refers to the owners goes with them: Kaizena Flow's store keeps each owner and applicant as a
  // customer with a deal and a link (D467, the house customers job), which are rows of its own store.
  await q.begin(async (tx) => {
    const customers = tx`(select id from commerce.customers where email like ${emails})`;
    const accounts = tx`(select id from commerce.accounts where email like ${emails})`;
    const requests = tx`(select id from commerce.access_requests where email like ${emails})`;
    await tx`delete from commerce.deals where customer_id in ${customers}`;
    await tx`delete from commerce.house_customer_links where customer_id in ${customers} or account_id in ${accounts} or request_id in ${requests}`;
    await tx`delete from commerce.customers where email like ${emails}`;
    // Each owner's organisation (the organisations migration of 17 November): its members first, then the organisation once no store is in it.
    const organisations = await tx<{ id: string }[]>`select distinct organisation_id as id from commerce.organisation_members where account_id in ${accounts}`;
    await tx`delete from commerce.organisation_members where account_id in ${accounts}`;
    for (const { id } of organisations) {
      await tx`delete from commerce.organisations o where o.id = ${id}::uuid and not o.platform
        and not exists (select 1 from commerce.stores s where s.organisation_id = o.id)
        and not exists (select 1 from commerce.organisation_members m where m.organisation_id = o.id)`;
    }
    await tx`delete from commerce.accounts where email like ${emails}`;
    await tx`delete from commerce.access_requests where email like ${emails}`;
  });
}

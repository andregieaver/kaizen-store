// Writes a year of made-up history for a demo store as plain SQL (D792): customers, newsletter subscribers, orders with their payments,
// invoices, parcels, deliveries, refunds and returns, stock movements, emails, carts and visits, so the admin of a store that has only a
// catalogue looks like one that has sold for a year. Run it for a store that is only ever a demo: most of what it writes is append-only and
// stays (orders, invoices, stock movements, the activity and event logs).
//
//   node scripts/demo-history.mjs --context ctx.json --out dir [--end 2026-11-19T12:00:00Z]
//   DATABASE_URL=… node scripts/demo-history.mjs --apply dir      runs the files in order, each in its own transaction
//
// The context is the store's facts as read from the database (`--context-sql` prints the query): its id, home market, owner, stock location,
// Stripe account and products with their prices. Everything else is drawn from a seeded random generator, so the same context and end give
// the same SQL. Every made-up person is on example.org, which the senders keep as `logged` and never send to (D792), and every row that a job
// would act on is written finished: orders paid long ago are sent and delivered, alerts are marked handled, refunds succeeded.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

export const CONTEXT_SQL = `select json_build_object(
  'storeId', s.id, 'slug', s.slug, 'name', s.name, 'country', s.country,
  'owner', (select m.account_id from commerce.store_members m where m.store_id = s.id and m.role = 'owner' order by m.created_at limit 1),
  'location', (select l.id from commerce.inventory_locations l where l.store_id = s.id and l.active order by l.priority, l.created_at limit 1),
  'stripeAccount', (select a.account_id from commerce.stripe_accounts a where a.store_id = s.id limit 1),
  'markets', (select json_agg(json_build_object('code', m.code, 'currency', m.currency, 'locale', m.default_locale) order by m.created_at) from commerce.markets m where m.store_id = s.id and m.active),
  'shipping', (select json_object_agg(r.market_code, json_build_object('amount', r.amount_minor, 'freeOver', r.free_over_minor)) from commerce.shipping_rates r where r.store_id = s.id),
  'products', (select json_agg(json_build_object('id', p.id, 'handle', p.handle, 'variant', v.id, 'sku', v.sku,
      'title', (select t.title from commerce.product_translations t where t.product_id = p.id order by t.locale limit 1),
      'prices', (select json_object_agg(c.market_code, c.amount_minor) from commerce.current_prices c where c.variant_id = v.id)) order by p.handle)
    from commerce.products p join commerce.product_variants v on v.product_id = p.id where p.store_id = s.id and p.status = 'active')
) as context from commerce.stores s where s.slug = :slug`;

// --- Deterministic randomness -----------------------------------------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rand = mulberry32(20251115);
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
function weighted(entries) {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = rand() * total;
  for (const [value, w] of entries) {
    r -= w;
    if (r <= 0) return value;
  }
  return entries[entries.length - 1][0];
}
function poisson(lambda) {
  const l = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rand();
  } while (p > l);
  return k - 1;
}
const hex = (n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");
function uuid() {
  const h = hex(32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20)}`;
}
const token = (n) => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  return Array.from({ length: n }, () => chars[Math.floor(rand() * 64)]).join("");
};

// --- SQL helpers ------------------------------------------------------------------------------------------------------------------------

const q = (v) => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return `'${v.toISOString()}'`;
  return `'${String(v).replaceAll("'", "''")}'`;
};
const j = (v) => `${q(JSON.stringify(v))}::jsonb`;
const ts = (d) => `'${d.toISOString()}'::timestamptz`;
const day = (d) => d.toISOString().slice(0, 10);
const addMinutes = (d, m) => new Date(d.getTime() + m * 60_000);
const addDays = (d, n) => addMinutes(d, n * 1440);

// --- People and places ------------------------------------------------------------------------------------------------------------------

const FIRST = {
  NO: ["Ingrid", "Kari", "Ola", "Lars", "Nora", "Emma", "Jonas", "Sofie", "Henrik", "Maja", "Erik", "Sigrid", "Magnus", "Ida", "Anders", "Thea", "Kristian", "Marte", "Even", "Hanna", "Tor", "Silje", "Ole", "Ragnhild", "Astrid", "Mathilde", "Sindre", "Live", "Eirik", "Vilde", "Håkon", "Solveig", "Tuva", "Aksel", "Marit", "Kjersti", "Øystein", "Line", "Camilla", "Petter"],
  SE: ["Elsa", "Alice", "Maja", "Astrid", "Oscar", "William", "Hugo", "Ebba", "Linnea", "Axel", "Klara", "Nils", "Freja", "Viktor", "Saga", "Agnes", "Elin", "Johan", "Karin", "Gustav", "Ingrid", "Lova", "Emil", "Wilma", "Björn"],
  DK: ["Freja", "Ida", "Clara", "Karla", "Mathias", "Lucas", "Emil", "Frederik", "Sofie", "Anna", "Magnus", "Mads", "Laura", "Asger", "Signe", "Mette", "Rasmus", "Line", "Søren", "Cecilie", "Jonas", "Nanna"],
};
const LAST = {
  NO: ["Hansen", "Johansen", "Olsen", "Larsen", "Andersen", "Pedersen", "Nilsen", "Kristiansen", "Jensen", "Karlsen", "Berg", "Haugen", "Hagen", "Johannessen", "Dahl", "Lie", "Strand", "Solberg", "Bakken", "Moen", "Lund", "Eide", "Holm", "Aas", "Myhre", "Sæther", "Vik", "Brekke", "Fossum", "Nygård"],
  SE: ["Andersson", "Johansson", "Karlsson", "Nilsson", "Eriksson", "Larsson", "Olsson", "Persson", "Svensson", "Gustafsson", "Lindberg", "Lindqvist", "Holm", "Berglund", "Sandberg", "Lundgren", "Forsberg", "Ek", "Sjöberg", "Wallin"],
  DK: ["Nielsen", "Jensen", "Hansen", "Pedersen", "Andersen", "Christensen", "Larsen", "Sørensen", "Rasmussen", "Jørgensen", "Madsen", "Kristensen", "Thomsen", "Poulsen", "Møller", "Holm", "Lund", "Frederiksen"],
};
const PLACES = {
  NO: [
    ["Oslo", ["Thorvald Meyers gate", "Markveien", "Bogstadveien", "Ullevålsveien", "Kirkeveien", "Sofies gate", "Grünerløkka torg", "Schweigaards gate"], () => `0${between(150, 190)}`, 40],
    ["Bergen", ["Nygårdsgaten", "Kong Oscars gate", "Sandviksveien", "Kalfarveien"], () => `50${between(10, 20)}`, 14],
    ["Trondheim", ["Olav Tryggvasons gate", "Kongens gate", "Bakkegata"], () => `70${between(10, 30)}`, 10],
    ["Stavanger", ["Pedersgata", "Kirkegata", "Løkkeveien"], () => `40${between(5, 15)}`, 8],
    ["Tromsø", ["Storgata", "Grønnegata"], () => `90${between(8, 12)}`, 4],
    ["Drammen", ["Bragernes torg", "Tollbugata"], () => `30${between(15, 19)}`, 5],
    ["Lillehammer", ["Storgata", "Kirkegata"], () => `26${between(9, 15)}`, 3],
  ],
  SE: [
    ["Stockholm", ["Götgatan", "Hornsgatan", "Södermannagatan", "Odengatan", "Sankt Eriksgatan"], () => `1${between(13, 18)} ${between(10, 70)}`, 45],
    ["Göteborg", ["Linnégatan", "Vasagatan", "Andra Långgatan"], () => `41${between(1, 7)} ${between(10, 70)}`, 20],
    ["Malmö", ["Davidshallsgatan", "Södra Förstadsgatan"], () => `21${between(1, 4)} ${between(10, 60)}`, 14],
    ["Uppsala", ["Svartbäcksgatan", "Kungsgatan"], () => `75${between(2, 4)} ${between(10, 50)}`, 8],
  ],
  DK: [
    ["København", ["Jægersborggade", "Vesterbrogade", "Nørrebrogade", "Istedgade", "Strandboulevarden"], () => `${between(1050, 2300)}`, 50],
    ["Aarhus", ["Frederiksgade", "Jægergårdsgade", "Mejlgade"], () => `80${between(0, 0)}0`, 22],
    ["Odense", ["Vestergade", "Kongensgade"], () => "5000", 10],
    ["Aalborg", ["Boulevarden", "Jomfru Ane Gade"], () => "9000", 8],
  ],
};
const ascii = (s) =>
  s
    .toLowerCase()
    .replaceAll("æ", "ae")
    .replaceAll("ø", "o")
    .replaceAll("å", "a")
    .replaceAll("ä", "a")
    .replaceAll("ö", "o")
    .replaceAll("é", "e");

// --- The year ---------------------------------------------------------------------------------------------------------------------------

const MONTH_FACTOR = { 0: 0.7, 1: 0.8, 2: 0.9, 3: 1.0, 4: 1.05, 5: 0.85, 6: 0.7, 7: 0.9, 8: 1.0, 9: 1.05, 10: 1.45, 11: 1.9 };
const WEEKDAY_FACTOR = [1.25, 1.15, 1.0, 0.95, 0.95, 0.85, 0.85];
const POPULAR = { cups: 22, "ridge-bowl": 18, "bud-vases": 15, "candle-holders": 14, "serving-dish": 10, pitcher: 9, "tall-vase": 7, "moon-jar": 5 };
const CARD_BRANDS = [["visa", 55], ["mastercard", 40], ["amex", 5]];

/** How busy a day is: a ramp from launch, the season and the weekday, with Black Week and the last days before Christmas. */
function dayFactor(d, start) {
  const months = (d - start) / (30.4 * 86_400_000);
  const ramp = 0.35 + 0.65 * Math.min(1, months / 8);
  let f = ramp * MONTH_FACTOR[d.getUTCMonth()] * WEEKDAY_FACTOR[d.getUTCDay()];
  const m = d.getUTCMonth();
  const date = d.getUTCDate();
  if (m === 10 && date >= 24) f *= 2.4; // Black Week
  if (m === 11 && date <= 2) f *= 1.8;
  if (m === 11 && date >= 21) f *= 0.35;
  return f;
}

// --- Generation -------------------------------------------------------------------------------------------------------------------------

export function generate(ctx, end) {
  rand = mulberry32(20251115);
  const S = ctx.storeId;
  const start = new Date("2025-09-15T00:00:00Z");
  const markets = Object.fromEntries(ctx.markets.map((m) => [m.code, m]));
  const products = ctx.products.map((p) => ({ ...p, weight: POPULAR[p.handle] ?? 8 }));
  const out = { files: [] };
  const file = (name, body) => out.files.push({ name, sql: `begin;\nset local statement_timeout = '120s';\nset local lock_timeout = '5s';\n${body}\ncommit;\n` });

  // People: a pool that grows as orders come in; some open an account, some come back.
  const people = [];
  const emails = new Set();
  function person(market, at) {
    const first = pick(FIRST[market]);
    const last = pick(LAST[market]);
    let email = `${ascii(first)}.${ascii(last)}@example.org`;
    for (let n = 2; emails.has(email); n += 1) email = `${ascii(first)}.${ascii(last)}${n}@example.org`;
    emails.add(email);
    const place = weighted(PLACES[market].map((p) => [p, p[3]]));
    const p = {
      id: uuid(),
      market,
      name: `${first} ${last}`,
      email,
      address: { name: `${first} ${last}`, line1: `${pick(place[1])} ${between(1, 88)}${chance(0.2) ? pick(["A", "B", "C"]) : ""}`, line2: null, postalCode: place[2](), city: place[0], country: market, phone: null },
      phone: market === "NO" ? `+47 ${between(400, 999)} ${between(10, 99)} ${between(100, 999)}` : market === "SE" ? `+46 70 ${between(100, 999)} ${between(10, 99)} ${between(10, 99)}` : `+45 ${between(20, 61)} ${between(10, 99)} ${between(10, 99)} ${between(10, 99)}`,
      account: chance(0.42),
      since: at,
      orders: [],
      subscribed: chance(0.55),
      loyal: chance(0.3),
    };
    people.push(p);
    return p;
  }

  // Orders, day by day.
  const orders = [];
  let expected = 0;
  for (let d = new Date(start); d < end; d = addDays(d, 1)) expected += dayFactor(d, start);
  const perUnit = 1480 / expected;
  for (let d = new Date(start); d < end; d = addDays(d, 1)) {
    const n = poisson(dayFactor(d, start) * perUnit);
    for (let k = 0; k < n; k += 1) {
      // Mostly evenings and lunch breaks, store time (UTC+1/+2).
      const hour = weighted([[7, 2], [9, 4], [11, 7], [12, 9], [13, 7], [15, 6], [17, 7], [19, 11], [20, 12], [21, 10], [22, 6]]);
      const at = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour - 1, between(0, 59), between(0, 59)));
      if (at >= end) continue;
      const market = weighted([["NO", 60], ["SE", 25], ["DK", 15]]);
      const returning = people.filter((p) => p.market === market && p.orders.length > 0 && p.since < addDays(at, -10));
      const comeBack = returning.length > 0 && chance(Math.min(0.3, 0.05 + returning.length / 1200));
      const buyer = comeBack ? (chance(0.6) ? pick(returning.filter((p) => p.loyal).length ? returning.filter((p) => p.loyal) : returning) : pick(returning)) : person(market, at);
      const order = { at, market, buyer };
      orders.push(order);
      buyer.orders.push(order);
    }
  }
  // A few unfinished checkouts that ran out (cancelled, never paid) among them.
  orders.sort((a, b) => a.at - b.at);

  // Discount codes and the one campaign.
  const codes = [
    { id: uuid(), code: "WELCOME10", percent: 10, from: start, to: null, share: 0.08, once: true },
    { id: uuid(), code: "JULEGAVE15", percent: 15, from: new Date("2025-12-01T00:00:00Z"), to: new Date("2025-12-20T23:00:00Z"), share: 0.22 },
    { id: uuid(), code: "SPRING15", percent: 15, from: new Date("2026-03-20T00:00:00Z"), to: new Date("2026-04-10T22:00:00Z"), share: 0.2 },
    { id: uuid(), code: "SUMMER15", percent: 15, from: new Date("2026-06-15T00:00:00Z"), to: new Date("2026-07-31T22:00:00Z"), share: 0.18 },
    { id: uuid(), code: "STUDIO20", percent: 20, from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-14T22:00:00Z"), share: 0.25 },
  ];
  const blackWeek = { id: uuid(), name: "Black Week: 20 % off everything", percent: 20, from: new Date("2025-11-24T00:00:00Z"), to: new Date("2025-12-01T22:59:00Z") };

  const now = end;
  const built = [];
  for (const o of orders) {
    const nLines = weighted([[1, 55], [2, 30], [3, 11], [4, 4]]);
    const chosen = new Set();
    while (chosen.size < nLines) chosen.add(weighted(products.map((p) => [p, p.weight])));
    const lines = [...chosen].map((p) => {
      const unit = p.prices[o.market];
      const quantity = p.handle === "cups" && chance(0.3) ? 2 : chance(0.06) ? 2 : 1;
      return { id: uuid(), p, unit, quantity, gross: unit * quantity, discount: 0, campaign: 0 };
    });
    const subtotal = lines.reduce((s, l) => s + l.gross, 0);
    let discount = 0;
    let code = null;
    let campaign = null;
    if (o.at >= blackWeek.from && o.at <= blackWeek.to && chance(0.85)) {
      campaign = blackWeek;
    } else {
      const live = codes.filter((c) => o.at >= c.from && (!c.to || o.at <= c.to));
      for (const c of live) {
        if (c.once && o.buyer.orders[0] !== o) continue;
        if (chance(c.share)) {
          code = c;
          break;
        }
      }
    }
    const percent = campaign?.percent ?? code?.percent ?? 0;
    if (percent > 0) {
      let left = Math.round((subtotal * percent) / 100);
      discount = left;
      lines.forEach((l, i) => {
        const share = i === lines.length - 1 ? left : Math.round((l.gross * percent) / 100);
        left -= share;
        if (campaign) l.campaign = share;
        l.discount = share;
      });
    }
    lines.forEach((l) => {
      l.total = l.gross - l.discount;
      l.tax = Math.round(l.total / 5);
    });
    const rate = ctx.shipping[o.market];
    const shipping = subtotal - discount >= rate.freeOver ? 0 : rate.amount;
    const total = subtotal + shipping - discount;
    const tax = lines.reduce((s, l) => s + l.tax, 0) + Math.round(shipping / 5);

    // What happened to it.
    const age = (now - o.at) / 86_400_000;
    let fate = "delivered";
    if (chance(0.075)) fate = "unpaid";
    else if (age < 1.2) fate = chance(0.75) ? "paid" : "sent";
    else if (age < 4) fate = chance(0.6) ? "sent" : "delivered";
    else if (chance(0.01)) fate = "cancelled_paid";
    else if (chance(0.015)) fate = "partial_refund";
    else if (age > 12 && chance(0.035)) fate = "returned";
    const paidAt = addMinutes(o.at, between(1, 4));
    const sentAt = addMinutes(o.at, (o.at.getUTCDay() === 6 ? 2 : o.at.getUTCDay() === 5 ? 3 : 1) * 1440 + between(-300, 240));
    const deliveredAt = addMinutes(sentAt, between(1, 4) * 1440 + between(-200, 200));
    const method = weighted([["card", 72], ["klarna", 18], ["link", 5], ["apple_pay", 5]]);
    built.push({
      ...o,
      id: uuid(),
      cart: uuid(),
      visitor: hex(24),
      lines,
      subtotal,
      discount,
      shipping,
      total,
      tax,
      code,
      campaign,
      fate,
      paidAt,
      sentAt: sentAt > now ? addMinutes(now, -30) : sentAt,
      deliveredAt: deliveredAt > now ? null : deliveredAt,
      method,
      brand: method === "card" || method === "apple_pay" ? weighted(CARD_BRANDS) : null,
      reference: `cs_test_${token(58)}`,
      tracking: o.market === "NO" ? `370${between(100000, 999999)}${between(100000, 999999)}${between(100, 999)}` : `00370${between(100000, 999999)}${between(100000, 999999)}${between(0, 9)}`,
    });
  }
  // A delivered order has to be delivered by now; one sent today is still on its way.
  for (const o of built) {
    if (o.fate === "delivered" && !o.deliveredAt) o.fate = "sent";
  }

  // --- 00: the store ---------------------------------------------------------------------------------------------------------------------
  const setup = [];
  setup.push(`-- The store's name as the demo shows it (the context's name; its address stays).
update commerce.stores set name = ${q(ctx.name)} where id = ${q(S)} and name <> ${q(ctx.name)};`);
  setup.push(`-- Euro-based rates for the store's currencies: analytics converts DKK and SEK to the main currency with them, and invoices in DKK and SEK state the VAT in NOK.
insert into commerce.store_currencies (store_id, currency, rate) values (${q(S)}, 'NOK', 11.70), (${q(S)}, 'SEK', 11.25), (${q(S)}, 'DKK', 7.46)
  on conflict (store_id, currency) do update set rate = excluded.rate;`);
  setup.push(`insert into commerce.invoice_settings (store_id, enabled, enabled_from) values (${q(S)}, true, ${ts(addDays(start, -10))})
  on conflict (store_id) do update set enabled = true, enabled_from = excluded.enabled_from;`);
  setup.push(`insert into commerce.store_tax_profile (store_id, vat_registered, vat_number, dispatch_country) values (${q(S)}, true, 'NO999999999MVA', 'NO')
  on conflict (store_id) do update set vat_registered = true, vat_number = coalesce(commerce.store_tax_profile.vat_number, excluded.vat_number), dispatch_country = 'NO';`);
  setup.push(`-- The catalogue was there from launch; what each piece cost to make, for the profit figures.
update commerce.products set created_at = ${ts(addDays(start, -20))} where store_id = ${q(S)} and created_at > ${ts(addDays(start, -20))};
update commerce.product_variants v set created_at = ${ts(addDays(start, -20))} from commerce.products p
 where p.id = v.product_id and p.store_id = ${q(S)} and v.created_at > ${ts(addDays(start, -20))};`);
  for (const p of products) setup.push(`update commerce.product_variants set cost_minor = ${Math.round(p.prices.NO * 0.32)} where store_id = ${q(S)} and id = ${q(p.variant)};`);
  setup.push(`-- The stock the shop opened with dates from launch.
set local session_replication_role = replica;
update commerce.inventory_movements set created_at = ${ts(addDays(start, -12))} where store_id = ${q(S)} and reason = 'opening' and created_at > ${ts(start)};
set local session_replication_role = origin;`);
  setup.push(`-- Discount codes used over the year, and Black Week's automatic discount (ended).
insert into commerce.discount_codes (id, store_id, code, kind, percent, starts_at, ends_at, once_per_customer, active, created_at) values
${codes.map((c) => `  (${q(c.id)}, ${q(S)}, ${q(c.code)}, 'percent', ${c.percent}, ${ts(c.from)}, ${c.to ? ts(c.to) : "null"}, ${Boolean(c.once)}, ${c.to ? "false" : "true"}, ${ts(addDays(c.from, -3))})`).join(",\n")};
insert into commerce.campaigns (id, store_id, name, kind, percent, starts_at, ends_at, active, created_at)
values (${q(blackWeek.id)}, ${q(S)}, ${q(blackWeek.name)}, 'percent', ${blackWeek.percent}, ${ts(blackWeek.from)}, ${ts(blackWeek.to)}, false, ${ts(addDays(blackWeek.from, -6))});`);
  file("00-store.sql", setup.join("\n"));

  // --- 10: customers with accounts --------------------------------------------------------------------------------------------------------
  const accountRows = people
    .filter((p) => p.account)
    .map((p) => {
      p.signedUp = addMinutes(p.since, -between(2, 30));
      return `  (${q(p.id)}, ${q(S)}, ${q(p.email)}, ${q(markets[p.market].locale)}, ${q(p.name)}, ${q(p.phone)}, ${j(p.address)}, ${ts(p.signedUp)}, ${ts(p.signedUp)}, ${ts(addMinutes(p.signedUp, 3))}, ${ts(addDays(p.signedUp, between(0, Math.max(1, Math.floor((now - p.signedUp) / 86_400_000)))))})`;
    });
  // People who opened an account and never bought.
  for (let i = 0; i < 70; i += 1) {
    const market = weighted([["NO", 60], ["SE", 25], ["DK", 15]]);
    const at = new Date(start.getTime() + rand() * (now - start));
    const p = person(market, at);
    p.account = true;
    p.subscribed = chance(0.6);
    p.signedUp = at;
    accountRows.push(`  (${q(p.id)}, ${q(S)}, ${q(p.email)}, ${q(markets[market].locale)}, ${q(p.name)}, '', '{}'::jsonb, ${ts(at)}, ${ts(at)}, ${ts(addMinutes(at, 3))}, ${ts(addMinutes(at, 5))})`);
  }
  file(
    "10-customers.sql",
    `insert into commerce.customers (id, store_id, email, locale, name, phone, address, created_at, updated_at, email_verified_at, last_sign_in_at) values\n${accountRows.join(",\n")};`,
  );

  // --- 20…: orders, a month to a file -----------------------------------------------------------------------------------------------------
  const byMonth = new Map();
  for (const o of built) {
    const key = o.at.toISOString().slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(o);
  }
  const stock = Object.fromEntries(products.map((p) => [p.variant, 40]));
  const refundIds = [];
  const moves = []; // [order id or null, variant, at] in the order they are written, to date the movements after
  let fileNo = 20;
  for (const [month, list] of byMonth) {
    const body = [];
    for (const o of list) body.push(...orderSql(o));
    body.push(...ordersTrailer());
    file(`${fileNo}-orders-${month}.sql`, body.join("\n"));
    fileNo += 1;
  }

  /** What closes a file of orders: their alerts and rules marked handled, and every stock movement written in it dated when it happened. */
  function ordersTrailer() {
    const out = [`-- Alerts and order rules for these orders were handled when they came in.
update commerce.store_events set alerts_done_at = coalesce(alerts_done_at, now()), rules_done_at = coalesce(rules_done_at, now())
 where store_id = ${q(S)} and created_at = now();`];
    const list = moves.splice(0);
    if (list.length) out.push(`-- Every movement written here is dated when it happened.
set local session_replication_role = replica;
update commerce.inventory_movements m set created_at = d.at, note = d.final from (values
${list.map(([key, at, final]) => `  (${q(key)}, ${ts(at)}, ${q(final)})`).join(",\n")}
) d(key, at, final) where m.store_id = ${q(S)} and m.note = d.key and m.created_at = now();
set local session_replication_role = origin;`);
    return out;
  }

  function stockSql(o, variant, delta, reason, source, at, note) {
    stock[variant] += delta;
    const key = `demo:${uuid()}`;
    moves.push([key, at, note ?? null]);
    const ctxJson = { reason, source, ...(o ? { order: o.id } : {}), note: key };
    return `select set_config('kaizen.stock', ${q(JSON.stringify(ctxJson))}, true);
update commerce.inventory_levels set on_hand = on_hand + (${delta}) where store_id = ${q(S)} and variant_id = ${q(variant)} and location_id = ${q(ctx.location)};`;
  }

  function orderSql(o) {
    const sql = [];
    const m = markets[o.market];
    const status = o.fate === "unpaid" ? "cancelled" : o.fate === "paid" ? "paid" : o.fate === "cancelled_paid" ? "cancelled" : "fulfilled";
    // Restock what is about to run short, a few days before.
    for (const l of o.lines) {
      if (!l.service && stock[l.p.variant] - l.quantity < 6 && o.fate !== "unpaid") {
        const qty = 40 + 10 * between(0, 3);
        sql.push(stockSql(null, l.p.variant, qty, "received", "inventory_page", addDays(o.at, -between(2, 6)), "New batch from the kiln"));
      }
    }
    const buyer = o.buyer;
    const customerId = buyer.account && buyer.signedUp && buyer.signedUp <= o.at ? buyer.id : null;
    const vat = { kind: "standard", vies: { status: "not_checked", checkedAt: null, registeredName: null, registeredAddress: null, requestIdentifier: null }, reason: "consumer", iossNumber: null, buyerCountry: o.market, shippingRate: 0.25, shippingRule: "standard", sellerCountry: "NO", buyerVatNumber: null, ossMemberState: null, dispatchCountry: "NO", sellerVatNumber: null, consignmentEurMinor: null };
    sql.push(`-- ${o.market} ${o.at.toISOString()} ${o.fate}
insert into commerce.orders (id, store_id, number, market_code, currency, locale, customer_id, cart_id, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
  billing_address, shipping_address, placed_at, created_at, delivered_at, delivered_source, discount_code_id, discount_code, campaign_discount_minor, campaign_label,
  delivery, standard_shipping_minor, return_cost_payer, vat_kind, shipping_tax_rate, vat_treatment, source, delivery_method, entered_codes)
values (${q(o.id)}, ${q(S)}, (select s.prefix || commerce.next_document_number(${q(S)}, 'order')::text from commerce.document_series s where s.store_id = ${q(S)} and s.series = 'order'),
  ${q(o.market)}, ${q(m.currency)}, ${q(m.locale)}, ${q(customerId)}, ${q(o.cart)}, ${q(buyer.email)}, ${q(o.terms ? "pending_payment" : status === "fulfilled" ? "paid" : status === "cancelled" && o.fate === "cancelled_paid" ? "paid" : status === "cancelled" ? "pending_payment" : status)},
  ${o.subtotal}, ${o.shipping}, ${o.discount}, ${o.tax}, ${o.total}, ${j(buyer.address)}, ${j(buyer.address)}, ${ts(o.at)}, ${ts(o.at)}, null, null,
  ${q(o.code?.id ?? null)}, ${q(o.code?.code ?? null)}, ${o.campaign ? o.discount : 0}, ${q(o.campaign ? o.campaign.name : null)},
  ${j({ kind: "flat", label: "Shipping", postalCode: buyer.address.postalCode })}, ${ctx.shipping[o.market].amount}, 'shopper', 'standard', 0.25, ${j(vat)}, 'checkout', 'ship', ${q(o.code ? `{${o.code.code}}` : "{}")});`);
    if (o.lines.some((l) => l.extended)) {
      // A booked service or a subscription's line (phase three): its own VAT rate, delivery and plan.
      sql.push(`insert into commerce.order_lines (id, store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code,
  withdrawal_exclusion, delivery, selling_plan_id, plan_interval, plan_interval_count, booked_count, unit_cost_minor, list_price_minor) values
${o.lines
  .map(
    (l) =>
      `  (${q(l.id)}, ${q(S)}, ${q(o.id)}, ${q(l.p.variant)}, ${q(l.p.sku)}, ${q(l.p.title)}, ${l.quantity}, ${l.unit}, ${l.discount}, ${l.total}, ${l.tax}, ${l.rate ?? 0.25}, ${q(l.taxCode ?? "txcd_99999999")}, ${q(l.service ? "dated_service" : "none")}, ${q(l.service ? "service" : "physical")}, ${q(l.plan?.id ?? null)}, ${q(l.plan?.interval ?? null)}, ${l.plan ? l.plan.count : "null"}, ${l.nights ?? "null"}, ${l.service ? "null" : Math.round(l.p.prices.NO * 0.32)}, ${l.list ?? l.unit})`,
  )
  .join(",\n")};`);
    } else
    sql.push(`insert into commerce.order_lines (id, store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code,
  withdrawal_exclusion, delivery, campaign_discount_minor, campaign_id, campaign_parts, unit_cost_minor, list_price_minor) values
${o.lines
  .map(
    (l) =>
      `  (${q(l.id)}, ${q(S)}, ${q(o.id)}, ${q(l.p.variant)}, ${q(l.p.sku)}, ${q(l.p.title)}, ${l.quantity}, ${l.unit}, ${l.discount}, ${l.total}, ${l.tax}, 0.25, 'txcd_99999999', 'none', 'physical', ${l.campaign}, ${q(l.campaign ? o.campaign.id : null)}, ${l.campaign ? j([{ id: o.campaign.id, minor: l.campaign }]) : "'[]'::jsonb"}, ${Math.round(l.p.prices.NO * 0.32) * 1}, ${l.unit})`,
  )
  .join(",\n")};`);
    if (o.afterLines) sql.push(o.afterLines);
    if (o.code) sql.push(`insert into commerce.order_discount_codes (store_id, order_id, position, code, discount_id, amount_minor, created_at) values (${q(S)}, ${q(o.id)}, 1, ${q(o.code.code)}, ${q(o.code.id)}, ${o.discount}, ${ts(o.at)});`);
    const paymentId = uuid();
    const paid = o.fate !== "unpaid";
    const fee = Math.round(o.total * 0.024) + 200;
    if (o.terms) sql.push(termsPlacedSql(o));
    else
    sql.push(`insert into commerce.payments (id, store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status, created_at, updated_at, kaizen_fee_minor, test_mode,
  method_type, wallet, card_brand, risk_level, risk_score, facts_read_at, provider_fee_minor, fee_currency)
values (${q(paymentId)}, ${q(S)}, ${q(o.id)}, 'stripe', ${q(o.reference)}, ${q(ctx.stripeAccount)}, ${o.total}, ${q(m.currency)}, ${q(paid ? "captured" : "cancelled")}, ${ts(o.at)}, ${ts(paid ? o.paidAt : addMinutes(o.at, 60))},
  ${Math.round(o.total * 0.02)}, false, ${q(paid ? (o.method === "apple_pay" ? "card" : o.method) : null)}, ${q(paid && o.method === "apple_pay" ? "apple_pay" : null)}, ${q(paid ? o.brand : null)},
  ${q(paid ? "normal" : null)}, ${paid ? between(3, 38) : "null"}, ${paid ? ts(addMinutes(o.paidAt, 2)) : "null"}, ${paid ? fee : "null"}, ${paid ? q(m.currency) : "null"});`);
    const events = [[o.at, "order.placed", {}, "shopper"], [addMinutes(o.at, 0.2), "payment.started", { ui: "custom", methods: ["card", "klarna", "link"] }, "system"]];
    if (!paid) events.push([addMinutes(o.at, 60), "order.cancelled", { reason: "checkout expired" }, "system"]);
    else events.push([o.paidAt, "order.paid", { reference: o.reference, was: "pending_payment" }, "stripe"]);
    sql.push(`insert into commerce.order_events (store_id, order_id, type, data, actor, created_at) values
${events.map(([at, type, data, actor]) => `  (${q(S)}, ${q(o.id)}, ${q(type)}, ${j(data)}, ${q(actor)}, ${ts(at)})`).join(",\n")};`);
    if (!paid) {
      sql.push(`update commerce.orders set status = 'cancelled' where store_id = ${q(S)} and id = ${q(o.id)};`);
      return sql;
    }
    // The sale draws the stock.
    for (const l of o.lines) if (!l.service) sql.push(stockSql(o, l.p.variant, -l.quantity, "sale", "checkout", o.paidAt));
    // The invoice, dated the day it was paid.
    const issued = day(o.paidAt);
    sql.push(`select set_config('commerce.issuing_document', ${q(o.id)}, true);
with snap as (select commerce.build_invoice_snapshot(${q(o.id)}::uuid, ${q(issued)}::date, ${q(issued)}::date) as s),
num as (select commerce.next_document_number(${q(S)}, 'invoice') as n, (select prefix from commerce.document_series where store_id = ${q(S)} and series = 'invoice') as pre),
ins as (
  insert into commerce.invoices (store_id, order_id, series, number, document_number, currency, total_minor, tax_minor, net_minor, kind, issued_on, supply_date, issued_at,
    locale, vat_kind, vat_home_currency, vat_home_minor, fx_rate, fx_as_of, fx_source, snapshot, public_token)
  select ${q(S)}, ${q(o.id)}, 'invoice', num.n, num.pre || num.n, ${q(m.currency)}, (snap.s -> 'totals' ->> 'grossMinor')::bigint, (snap.s -> 'totals' ->> 'vatMinor')::bigint,
    (snap.s -> 'totals' ->> 'netMinor')::bigint, 'order', ${q(issued)}::date, ${q(issued)}::date, ${ts(addMinutes(o.paidAt, 1))}, ${q(m.locale)}, 'standard',
    snap.s -> 'vatHome' ->> 'currency', (snap.s -> 'vatHome' ->> 'vatMinor')::bigint, (snap.s -> 'vatHome' ->> 'fxRate')::numeric, case when snap.s -> 'vatHome' ->> 'currency' is not null then ${q(issued)}::date end, snap.s -> 'vatHome' ->> 'source',
    jsonb_set(jsonb_set(snap.s, '{number}', to_jsonb(num.pre || num.n)), '{vatHome,asOf}', to_jsonb(${q(issued)}::text), false), commerce.new_document_token('inv_')
  from snap, num
  returning id, document_number
)
insert into commerce.order_events (store_id, order_id, type, data, actor, created_at)
select ${q(S)}, ${q(o.id)}, 'invoice.issued', jsonb_build_object('invoiceId', id, 'number', document_number), 'system', ${ts(addMinutes(o.paidAt, 1))} from ins;
select set_config('commerce.issuing_document', '', true);`);
    sql.push(emailSql(o, "order.confirmation", addMinutes(o.paidAt, 1), `${ctx.name}: order confirmed`, `Thank you for your order. We will let you know when it is on its way.`));

    if (o.fate === "cancelled_paid") {
      const at = addMinutes(o.paidAt, between(60, 600));
      sql.push(refundSql(o, paymentId, o.total, "Cancelled at the customer's request before it was sent", at, true));
      sql.push(`update commerce.orders set status = 'cancelled' where store_id = ${q(S)} and id = ${q(o.id)};
insert into commerce.order_events (store_id, order_id, type, data, actor, created_at) values (${q(S)}, ${q(o.id)}, 'order.cancelled', ${j({ reason: "customer asked" })}, 'staff', ${ts(addMinutes(at, 1))});`);
      return sql;
    }
    if (o.fate === "paid") return sql;

    // Sent: one parcel with every line.
    const shipment = uuid();
    const carrier = o.market === "NO" ? "Posten" : "PostNord";
    const url = o.market === "NO" ? `https://sporing.posten.no/sporing/${o.tracking}` : `https://tracking.postnord.com/se/?id=${o.tracking}`;
    sql.push(`insert into commerce.shipments (id, store_id, order_id, carrier, tracking_number, tracking_url, created_by, created_at, method, label_cost_minor) values
  (${q(shipment)}, ${q(S)}, ${q(o.id)}, ${q(carrier)}, ${q(o.tracking)}, ${q(url)}, ${q(ctx.owner)}, ${ts(o.sentAt)}, 'parcel', ${o.market === "DK" ? 5900 : 8900});
insert into commerce.shipment_lines (store_id, shipment_id, order_line_id, quantity, created_at) values
${o.lines.map((l) => `  (${q(S)}, ${q(shipment)}, ${q(l.id)}, ${l.quantity}, ${ts(o.sentAt)})`).join(",\n")};
insert into commerce.order_events (store_id, order_id, type, data, actor, created_at) values (${q(S)}, ${q(o.id)}, 'order.sent',
  ${j({ carrier, tracking: o.tracking, shipment, units: o.lines.reduce((s, l) => s + l.quantity, 0), left: 0, lines: o.lines.map((l) => ({ lineId: l.id, quantity: l.quantity })), method: "parcel" })}, 'staff', ${ts(o.sentAt)});
update commerce.orders set status = 'fulfilled' where store_id = ${q(S)} and id = ${q(o.id)} and status = 'paid';`);
    sql.push(emailSql(o, "order.sent", addMinutes(o.sentAt, 1), `${ctx.name}: your order is on its way`, `Your parcel is with ${carrier}. Track it: ${url}`));
    if (o.fate === "sent") return sql;

    sql.push(`select set_config('kaizen.carrier_delivery', ${q(o.id)}, true);
update commerce.orders set delivered_at = ${ts(o.deliveredAt)}, delivered_source = 'carrier' where store_id = ${q(S)} and id = ${q(o.id)};
insert into commerce.order_events (store_id, order_id, type, data, actor, created_at) values (${q(S)}, ${q(o.id)}, 'order.delivered', ${j({ by: "carrier", carrier, at: o.deliveredAt.toISOString() })}, 'system', ${ts(o.deliveredAt)});`);

    if (o.fate === "partial_refund") {
      const l = o.lines[0];
      const amount = Math.round(l.total / l.quantity);
      sql.push(refundSql(o, paymentId, amount, `${l.p.title} arrived chipped`, addDays(o.deliveredAt, between(1, 3)), false));
    }
    if (o.fate === "returned") sql.push(...returnSql(o, paymentId));
    if (o.terms) sql.push(termsPaidSql(o));
    return sql;
  }

  /** A company's order on payment terms (phase three): placed owing, the terms recorded, then moved to paid as checkout does. */
  function termsPlacedSql(o) {
    const due = day(addDays(o.at, 30));
    return `update commerce.orders set company_name = ${q(o.terms.company)}, organisation_number = ${q(o.terms.number)}, balance_minor = ${o.total} where store_id = ${q(S)} and id = ${q(o.id)};
insert into commerce.order_payment_terms (store_id, order_id, company_id, terms, due_on, created_at) values (${q(S)}, ${q(o.id)}, ${q(o.terms.id)}, 'net_30', ${q(due)}, ${ts(o.at)});
insert into commerce.order_events (store_id, order_id, type, data, actor, created_at) values (${q(S)}, ${q(o.id)}, 'order.terms_placed', ${j({ terms: "net_30", dueOn: due })}, 'shopper', ${ts(addMinutes(o.at, 0.1))});
insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, created_at, updated_at, kaizen_fee_minor)
values (${q(S)}, ${q(o.id)}, 'terms', ${q(`terms_${hex(24)}`)}, ${o.total}, ${q(markets[o.market].currency)}, 'pending', ${ts(o.at)}, ${ts(o.at)}, 0);
update commerce.orders set status = 'paid' where store_id = ${q(S)} and id = ${q(o.id)};`;
  }

  /** The company paid the invoice by bank transfer within its terms. */
  function termsPaidSql(o) {
    const at = addDays(o.at, between(12, 29));
    if (at > now) return "";
    return `insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, created_at, updated_at, kaizen_fee_minor, method, recorded_by, received_on)
values (${q(S)}, ${q(o.id)}, 'manual', ${q(`manual_terms_${uuid()}`)}, ${o.total}, ${q(markets[o.market].currency)}, 'captured', ${ts(at)}, ${ts(at)}, 0, 'bank_transfer', ${q(ctx.owner)}, ${q(day(at))});
update commerce.orders set balance_minor = 0 where store_id = ${q(S)} and id = ${q(o.id)};
update commerce.order_payment_terms set paid_at = ${ts(at)} where store_id = ${q(S)} and order_id = ${q(o.id)};
update commerce.payments set status = 'cancelled' where store_id = ${q(S)} and order_id = ${q(o.id)} and provider = 'terms';
insert into commerce.order_events (store_id, order_id, type, data, actor, created_at) values (${q(S)}, ${q(o.id)}, 'order.terms_paid', ${j({ via: "outside", amount: o.total, method: "bank_transfer", receivedOn: day(at) })}, 'staff', ${ts(at)});`;
  }

  function refundSql(o, paymentId, amount, reason, at, restock) {
    const id = uuid();
    const sql = [`insert into commerce.refunds (id, store_id, payment_id, amount_minor, reason, provider_reference, status, created_at, restocked, created_by, kind)
values (${q(id)}, ${q(S)}, ${q(paymentId)}, ${amount}, ${q(reason)}, ${q(`re_test_${token(24)}`)}, 'succeeded', ${ts(at)}, ${restock ? j(o.lines.map((l) => ({ sku: l.p.sku, quantity: l.quantity }))) : "'[]'::jsonb"}, ${q(ctx.owner)}, 'money');
insert into commerce.order_events (store_id, order_id, type, data, actor, created_at) values (${q(S)}, ${q(o.id)}, 'order.refunded',
  ${j({ amount, reason, restocked: restock ? o.lines.map((l) => ({ sku: l.p.sku, quantity: l.quantity })) : [] })}, 'staff', ${ts(at)});`];
    if (restock) for (const l of o.lines) sql.push(stockSql(o, l.p.variant, l.quantity, "order_restock", "order", at));
    sql.push(emailSql(o, "order.refunded", addMinutes(at, 1), `${ctx.name}: your refund`, `We have refunded ${(amount / 100).toFixed(2)} ${markets[o.market].currency}.`));
    o.refundId = id;
    refundIds.push(id);
    return sql.join("\n");
  }

  function returnSql(o, paymentId) {
    const id = uuid();
    const l = o.lines[Math.floor(rand() * o.lines.length)];
    const reason = weighted([["changed_mind", 45], ["not_as_described", 15], ["damaged_in_transit", 20], ["wrong_item", 5], ["other", 15]]);
    const requested = addDays(o.deliveredAt, between(1, 9));
    const approved = addMinutes(requested, between(60, 1500));
    const shipped = addDays(approved, between(1, 3));
    const received = addDays(shipped, between(2, 4));
    const inspected = addMinutes(received, between(30, 600));
    const closed = addMinutes(inspected, between(5, 120));
    const open = closed > addDays(end, -1);
    const amount = l.total;
    const sql = [];
    sql.push(`insert into commerce.returns (id, store_id, order_id, status, kind, reason, reason_note, created_at, updated_at)
values (${q(id)}, ${q(S)}, ${q(o.id)}, 'requested', 'return', ${q(reason)}, ${q(reason === "changed_mind" ? "It did not suit the room after all." : reason === "damaged_in_transit" ? "The rim had a crack when I opened the box." : null)}, ${ts(requested)}, ${ts(requested)});
insert into commerce.return_lines (store_id, return_id, order_line_id, quantity, condition, reason, restock, decision) values
  (${q(S)}, ${q(id)}, ${q(l.id)}, ${l.quantity}, ${q(reason === "damaged_in_transit" ? "damaged" : "as_new")}, ${q(reason)}, ${reason !== "damaged_in_transit"}, 'accept');
update commerce.returns set status = 'approved', approved_at = ${ts(approved)}, updated_at = ${ts(approved)} where store_id = ${q(S)} and id = ${q(id)};
update commerce.returns set status = 'in_transit', shipped_at = ${ts(shipped)}, updated_at = ${ts(shipped)} where store_id = ${q(S)} and id = ${q(id)};`);
    if (open) return sql;
    sql.push(`update commerce.returns set status = 'received', received_at = ${ts(received)}, updated_at = ${ts(received)} where store_id = ${q(S)} and id = ${q(id)};
update commerce.returns set status = 'inspected', inspected_at = ${ts(inspected)}, updated_at = ${ts(inspected)} where store_id = ${q(S)} and id = ${q(id)};`);
    sql.push(refundSql(o, paymentId, amount, "Return received", closed, false));
    if (reason !== "damaged_in_transit") sql.push(stockSql(o, l.p.variant, l.quantity, "return_restock", "return", inspected));
    sql.push(`update commerce.returns set status = 'closed', closed_at = ${ts(closed)}, outcome = 'refunded', refund_id = ${q(o.refundId)}, refund_minor = ${amount}, refund_computed_minor = ${amount},
  refunded_at = ${ts(closed)}, updated_at = ${ts(closed)} where store_id = ${q(S)} and id = ${q(id)};`);
    return sql;
  }

  function emailSql(o, kind, at, subject, line) {
    const html = `<!doctype html><html lang="en"><body style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"><h1 style="font-size:22px">${subject.replace(`${ctx.name}: `, "")}</h1><p>Hi ${o.buyer.name.split(" ")[0]},</p><p>${line}</p><p>${o.lines.map((l) => `${l.quantity} × ${l.p.title}`).join("<br>")}</p></body></html>`;
    const text = `Hi ${o.buyer.name.split(" ")[0]},\n\n${line}\n\n${o.lines.map((l) => `${l.quantity} × ${l.p.title}`).join("\n")}`;
    return `insert into commerce.email_messages (store_id, kind, idempotency_key, to_address, subject, html, text, status, order_id, created_at, sent_at)
values (${q(S)}, ${q(kind)}, ${q(`demo:${kind}:${o.id}:${uuid().slice(0, 8)}`)}, ${q(o.buyer.email)}, ${q(subject)}, ${q(html)}, ${q(text)}, 'delivered', ${q(o.id)}, ${ts(at)}, ${ts(at)});`;
  }

  // --- 45: credit notes ------------------------------------------------------------------------------------------------------------------
  // A refund's credit note is made when the refund's transaction commits, dated that day (`make_credit_note()`); each one made for a refund
  // written here is dated the day of its refund, in its row, its snapshot and the order's history.
  file(
    "45-credit-notes.sql",
    `set local session_replication_role = replica;
with seeded as (select unnest(array[${refundIds.map(q).join(", ")}]::uuid[]) as id),
fixed as (
  update commerce.credit_notes c set issued_on = (r.created_at at time zone 'Europe/Oslo')::date, issued_at = r.created_at + interval '1 minute',
    snapshot = jsonb_set(c.snapshot, '{issuedOn}', to_jsonb(((r.created_at at time zone 'Europe/Oslo')::date)::text))
  from commerce.refunds r join seeded on seeded.id = r.id
  where c.store_id = ${q(S)} and c.refund_id = r.id
  returning c.id, c.issued_at
)
update commerce.order_events e set created_at = fixed.issued_at from fixed
 where e.store_id = ${q(S)} and e.type = 'credit_note.issued' and e.data ->> 'creditNoteId' = fixed.id::text;
set local session_replication_role = origin;`,
  );

  // --- 50: newsletter subscribers ---------------------------------------------------------------------------------------------------------
  const subs = [];
  for (const p of people) {
    if (!p.subscribed) continue;
    const at = p.orders.length ? built.find((o) => o.buyer === p)?.at ?? p.since : p.since;
    subs.push({ id: uuid(), p, at, source: p.orders.length ? "checkout" : p.account ? "account" : "form" });
  }
  // Sign-ups from the newsletter form who never bought.
  for (let i = 0; i < 380; i += 1) {
    const market = weighted([["NO", 62], ["SE", 24], ["DK", 14]]);
    const at = new Date(start.getTime() + Math.pow(rand(), 0.8) * (now - start));
    const p = person(market, at);
    p.account = false;
    subs.push({ id: uuid(), p, at, source: "form" });
  }
  const subRows = subs.map(({ id, p, at, source }) => {
    const words = source === "checkout" ? `Yes, send me news and offers from ${ctx.name}.` : "Get news about new pieces and studio sales.";
    return `  (${q(id)}, ${q(S)}, ${q(p.email)}, ${q(p.account ? p.id : null)}, ${q(p.name)}, ${q(markets[p.market].locale)}, ${q(p.market)}, 'subscribed', ${q(source)}, ${q(words)}, ${ts(at)}, ${ts(addMinutes(at, 2))}, ${q(token(43))}, ${ts(at)}, ${ts(at)})`;
  });
  file(
    "50-subscribers.sql",
    `insert into commerce.marketing_subscribers (id, store_id, email, customer_id, name, locale, market_code, status, source, consent_text, consented_at, confirmed_at, token, created_at, updated_at) values
${subRows.join(",\n")};
-- The consent each one gave is dated when they gave it.
set local session_replication_role = replica;
update commerce.marketing_consent_events e set created_at = s.consented_at
  from commerce.marketing_subscribers s where s.id = e.subscriber_id and s.store_id = ${q(S)} and e.created_at = now();
set local session_replication_role = origin;`,
  );

  engagement({ S, start, now, markets, products, people, built, subs, file, ctx });

  // --- 60: carts and visits ---------------------------------------------------------------------------------------------------------------
  // Each order came from a cart in a visit; the other visits are made in the database, day by day, with the same mix of channels.
  const visitRows = [];
  const cartRows = [];
  const cartLineRows = [];
  for (const o of built) {
    const visit = uuid();
    const channel = weighted([["direct", 26], ["organic_search", 30], ["organic_social", 14], ["paid_social", 10], ["email", 12], ["referral", 5], ["paid_search", 3]]);
    const landing = chance(0.5) ? "/" + o.market.toLowerCase() : `/${o.market.toLowerCase()}/p/${pick(o.lines).p.handle}`;
    visitRows.push(`  (${q(visit)}, ${q(S)}, ${q(day(o.at))}, ${q(o.visitor)}, ${q(o.market)}, ${q(weighted([["mobile", 62], ["desktop", 32], ["tablet", 6]]))}, ${q(channel)}, ${q(sourceOf(channel) ?? "")}, ${q(channel === "email" ? "newsletter" : channel === "paid_social" ? "always-on" : "")}, ${q(landing)}, ${between(3, 14)}, ${between(1, 6)}, ${ts(addMinutes(o.at, -2))}, ${ts(addMinutes(o.at, -between(6, 40)))}, ${ts(addMinutes(o.at, 3))})`);
    cartRows.push(`  (${q(o.cart)}, ${q(S)}, ${q(o.market)}, ${q(markets[o.market].currency)}, ${q(markets[o.market].locale)}, ${q(o.fate === "unpaid" ? "abandoned" : "converted")}, ${ts(addMinutes(o.at, -between(5, 30)))}, ${ts(o.at)}, ${ts(addDays(o.at, 30))}, ${q(visit)}, null)`);
    for (const l of o.lines) cartLineRows.push(`  (${q(S)}, ${q(o.cart)}, ${q(l.p.variant)}, ${l.quantity})`);
  }
  const chunks = (rows, n) => Array.from({ length: Math.ceil(rows.length / n) }, (_, i) => rows.slice(i * n, i * n + n));
  file(
    "15-carts.sql",
    `${chunks(visitRows, 500)
      .map((rows) => `insert into commerce.visits (id, store_id, day, visitor, market_code, device, channel, source, campaign, landing_path, page_views, product_views, checkout_at, first_seen, last_seen) values\n${rows.join(",\n")};`)
      .join("\n")}
${chunks(cartRows, 500)
  .map((rows) => `insert into commerce.carts (id, store_id, market_code, currency, locale, status, created_at, updated_at, expires_at, visit_id, source) values\n${rows.join(",\n")};`)
  .join("\n")}
${chunks(cartLineRows, 800)
  .map((rows) => `insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity) values\n${rows.join(",\n")};`)
  .join("\n")}`,
  );

  // The visits that bought nothing: about 55 for each order, in the same daily rhythm, made in the database from a fixed seed.
  file(
    "61-visits.sql",
    `select setseed(0.4242);
insert into commerce.visits (store_id, day, visitor, market_code, device, channel, source, campaign, landing_path, page_views, product_views, checkout_at, first_seen, last_seen)
select ${q(S)}, d.day, substr(md5(d.day::text || '-' || g::text || '-demo'), 1, 24),
  (array['NO','NO','NO','NO','NO','NO','SE','SE','SE','DK','DK'])[1 + floor(random() * 11)::int]::bpchar,
  (array['mobile','mobile','mobile','mobile','mobile','mobile','desktop','desktop','desktop','tablet'])[1 + floor(random() * 10)::int],
  c.channel, c.source, c.campaign,
  case when random() < 0.45 then '/no' when random() < 0.5 then '/no/p/' || (array[${products.map((p) => q(p.handle)).join(", ")}])[1 + floor(random() * ${products.length})::int] else '/no/category/' || (array['tableware','vases','objects'])[1 + floor(random() * 3)::int] end,
  1 + floor(random() * random() * 9)::int, floor(random() * random() * 5)::int,
  case when random() < 0.012 then d.day + interval '20 hours' else null end,
  d.day + make_interval(hours => 6 + floor(random() * 17)::int, mins => floor(random() * 60)::int),
  d.day + make_interval(hours => 6 + floor(random() * 17)::int, mins => floor(random() * 60)::int) + interval '4 minutes'
from (select day::date as day, n from (values ${dailyVisits(built, start, end)
      .map(([d, n]) => `('${d}'::date, ${n})`)
      .join(", ")}) v(day, n)) d
cross join lateral generate_series(1, d.n) g
cross join lateral (select * from (values
  ('direct', ''::text, ''::text, 26), ('organic_search', 'google', '', 33), ('organic_social', 'instagram', '', 14), ('paid_social', 'instagram', 'always-on', 9),
  ('email', 'newsletter', 'newsletter', 8), ('referral', 'pinterest', '', 6), ('paid_search', 'google', 'brand', 4)) ch(channel, source, campaign, w)
  order by -ln(random()) / ch.w + 0 * g limit 1) c
on conflict (store_id, day, visitor) do nothing;
-- Product views per day follow the visits.
insert into commerce.product_views (store_id, day, product_id, views)
select ${q(S)}, v.day, p.id, greatest(1, round(count(*) * p.w * (0.8 + random() * 0.4)))::int
from commerce.visits v
cross join (values ${products.map((p) => `(${q(p.id)}::uuid, ${(p.weight / 100 + 0.02).toFixed(3)})`).join(", ")}) p(id, w)
where v.store_id = ${q(S)} and v.product_views > 0 and v.day >= '${day(start)}'
group by v.day, p.id, p.w
on conflict (store_id, day, product_id) do update set views = excluded.views;`,
  );

  // --- 90…: the selling features (phase three) ------------------------------------------------------------------------------------------
  // Subscriptions, a subscription box, a class taught by two people and a guest room, each with its own orders, written like the year's.
  // Their orders are numbered after the year's (the numbers follow the order they are written in, not their dates).

  function newOrder(at, market, buyer, lines, service = false) {
    const ls = lines.map((l) => ({ id: uuid(), discount: 0, campaign: 0, extended: true, ...l }));
    for (const l of ls) {
      l.total = l.unit * l.quantity;
      const r = l.rate ?? 0.25;
      l.tax = Math.round((l.total * r) / (1 + r));
    }
    const subtotal = ls.reduce((s, l) => s + l.total, 0);
    const rate = ctx.shipping[market];
    const shipping = service || subtotal >= rate.freeOver ? 0 : rate.amount;
    const paidAt = addMinutes(at, between(1, 4));
    const sentAt = addMinutes(at, 1440 + between(-300, 240));
    const deliveredAt = addMinutes(sentAt, between(1, 3) * 1440 + between(-200, 200));
    const age = (now - at) / 86_400_000;
    let fate = service ? "paid" : age < 1.2 ? "paid" : deliveredAt > now ? "sent" : "delivered";
    if (!service && fate === "sent" && sentAt > now) fate = "paid";
    const method = weighted([["card", 72], ["klarna", 18], ["link", 5], ["apple_pay", 5]]);
    return {
      id: uuid(), at, market, buyer, lines: ls, subtotal, discount: 0, shipping, total: subtotal + shipping,
      tax: ls.reduce((s, l) => s + l.tax, 0) + Math.round(shipping / 5), code: null, campaign: null, fate, cart: null, paidAt,
      sentAt: sentAt > now ? addMinutes(now, -30) : sentAt, deliveredAt: deliveredAt > now ? null : deliveredAt, method,
      brand: method === "card" || method === "apple_pay" ? weighted(CARD_BRANDS) : null, reference: `cs_test_${token(58)}`,
      tracking: market === "NO" ? `370${between(100000, 999999)}${between(100000, 999999)}${between(100, 999)}` : `00370${between(100000, 999999)}${between(100000, 999999)}${between(0, 9)}`,
    };
  }
  const ordersFile = (name, head, orders, tail) => {
    orders.sort((a, b) => a.at - b.at);
    const body = [...head];
    for (const o of orders) body.push(...orderSql(o));
    body.push(...tail, ...ordersTrailer());
    file(name, body.join("\n"));
  };
  const byHandle = Object.fromEntries(products.map((p) => [p.handle, p]));
  const members = people.filter((p) => p.account && p.signedUp && p.market === "NO");
  const used = new Set();
  const member = (before) => {
    const list = members.filter((p) => p.signedUp < before && !used.has(p.id));
    const p = pick(list);
    used.add(p.id);
    return p;
  };
  const addMonths = (d, n) => {
    const x = new Date(d);
    x.setUTCMonth(x.getUTCMonth() + n);
    return x;
  };
  const oslo = (dayString, hhmm) => `(${q(`${dayString} ${hhmm}`)}::timestamp at time zone 'Europe/Oslo')`;

  function features() {
    // Subscriptions: cups every two months, bud vases every three, both a little cheaper for subscribers.
    const plans = [
      { id: uuid(), p: byHandle.cups, count: 2, percent: 10 },
      { id: uuid(), p: byHandle["bud-vases"], count: 3, percent: 15 },
    ].filter((x) => x.p);
    const head = [`insert into commerce.selling_plans (id, store_id, product_id, "interval", interval_count, discount_percent, position, active, created_at) values
${plans.map((x, i) => `  (${q(x.id)}, ${q(S)}, ${q(x.p.id)}, 'month', ${x.count}, ${x.percent}, ${i}, true, ${ts(new Date("2025-11-20T09:00:00Z"))})`).join(",\n")};`];
    const subOrders = [];
    const tail = [];
    for (let i = 0; i < 25 && plans.length; i += 1) {
      const plan = weighted(plans.map((x) => [x, x.count === 2 ? 60 : 40]));
      const startAt = new Date(new Date("2025-11-25T00:00:00Z").getTime() + rand() * (addDays(now, -40) - new Date("2025-11-25T00:00:00Z")));
      const who = member(startAt);
      const status = i < 15 ? "active" : i < 19 ? "paused" : "cancelled";
      const unit = Math.round((plan.p.prices.NO * (100 - plan.percent)) / 100);
      const line = { p: plan.p, unit, quantity: 1, plan: { id: plan.id, interval: "month", count: plan.count }, list: plan.p.prices.NO };
      const stopAt = status === "cancelled" ? addDays(startAt, between(70, 200)) : status === "paused" ? addDays(now, -between(5, 40)) : now;
      const orders = [];
      for (let k = 0, at = startAt; at < stopAt && at < now; k += 1, at = addMonths(startAt, plan.count * k)) {
        if (k > 0) orders.push(newOrder(addMinutes(at, between(0, 60)), "NO", who, [line]));
        else orders.push(newOrder(at, "NO", who, [line]));
      }
      if (!orders.length) continue;
      subOrders.push(...orders);
      let next = startAt;
      while (next <= now) next = addMonths(next, plan.count);
      const last = orders.at(-1).at;
      const id = uuid();
      const shipping = unit >= ctx.shipping.NO.freeOver ? 0 : ctx.shipping.NO.amount;
      const tax = Math.round(unit / 5) + Math.round(shipping / 5);
      const cancelled = status === "cancelled" ? addDays(last, between(3, 30)) : null;
      const periodEnd = status === "cancelled" ? addMonths(last, plan.count) : next;
      tail.push(`insert into commerce.subscriptions (id, store_id, number, status, market_code, currency, locale, email, shipping_address, "interval", interval_count, subtotal_minor, shipping_minor, total_minor, tax_minor,
  first_order_id, provider, current_period_end, cancel_at_period_end, cancelled_at, manage_token, created_at, updated_at, customer_id, paused_until, reminded_for)
values (${q(id)}, ${q(S)}, (select number from commerce.orders where store_id = ${q(S)} and id = ${q(orders[0].id)}), ${q(status)}, 'NO', 'NOK', ${q(markets.NO.locale)}, ${q(who.email)}, ${j(who.address)}, 'month', ${plan.count},
  ${unit}, ${shipping}, ${unit + shipping}, ${tax}, ${q(orders[0].id)}, 'stripe', ${ts(periodEnd)}, ${status === "active" && i < 2}, ${cancelled ? ts(cancelled) : "null"}, ${q(hex(64))}, ${ts(startAt)}, ${ts(cancelled ?? last)},
  ${q(who.id)}, ${status === "paused" ? ts(addDays(now, between(14, 60))) : "null"}, ${status === "active" ? ts(periodEnd) : "null"});
insert into commerce.subscription_lines (store_id, subscription_id, variant_id, selling_plan_id, sku, title, quantity, unit_price_minor, total_minor, tax_rate, tax_code, delivery)
values (${q(S)}, ${q(id)}, ${q(plan.p.variant)}, ${q(plan.id)}, ${q(plan.p.sku)}, ${q(plan.p.title)}, 1, ${unit}, ${unit}, 0.25, 'txcd_99999999', 'physical');
update commerce.orders set subscription_id = ${q(id)} where store_id = ${q(S)} and id in (${orders.map((o) => q(o.id)).join(", ")});`);
    }
    ordersFile("90-subscriptions.sql", head, subOrders, tail);

    // A subscription box: a Friday delivery for Oslo, lists that customers keep, and their past boxes. No list has consented to the
    // automatic orders (consent_at is null), so no job makes new box orders or charges a card; the lists look as they did.
    const schedule = uuid();
    const boxHead = [`insert into commerce.delivery_schedules (id, store_id, market_code, currency, name, delivery_weekday, cutoff_days, cutoff_time, active, created_at, updated_at)
values (${q(schedule)}, ${q(S)}, 'NO', 'NOK', 'Friday delivery, Oslo', 5, 2, '23:59', true, ${ts(new Date("2026-04-20T09:00:00Z"))}, ${ts(new Date("2026-04-20T09:00:00Z"))});`];
    const boxOrders = [];
    const boxTail = [];
    for (let i = 0; i < 14; i += 1) {
      const created = new Date(new Date("2026-05-01T00:00:00Z").getTime() + rand() * (addDays(now, -60) - new Date("2026-05-01T00:00:00Z")));
      const who = member(created);
      const status = i < 11 ? "active" : i < 13 ? "paused" : "cancelled";
      const list = uuid();
      const items = new Set();
      const k = between(1, 3);
      while (items.size < k) items.add(weighted(products.map((x) => [x, x.weight])));
      const lines = [...items].map((x) => ({ p: x, quantity: x.handle === "cups" ? 2 : 1 }));
      const cancelled = status === "cancelled" ? addDays(created, between(40, 90)) : null;
      boxHead.push(`insert into commerce.standing_orders (id, store_id, customer_id, schedule_id, status, shipping_address, stripe_account, mode, payment_method, card_label, created_at, updated_at, cancelled_at)
values (${q(list)}, ${q(S)}, ${q(who.id)}, ${q(schedule)}, ${q(status)}, ${j(who.address)}, ${q(ctx.stripeAccount)}, 'test', ${q(`pm_demo_${hex(20)}`)}, ${q(`${pick(["Visa", "Mastercard"])} •••• ${between(1000, 9999)}`)}, ${ts(created)}, ${ts(cancelled ?? created)}, ${cancelled ? ts(cancelled) : "null"});
insert into commerce.standing_order_lines (store_id, standing_order_id, variant_id, quantity, created_at, updated_at) values
${lines.map((l) => `  (${q(S)}, ${q(list)}, ${q(l.p.variant)}, ${l.quantity}, ${ts(created)}, ${ts(created)})`).join(",\n")};`);
      // Every fourth Friday a box went out; now and then one was skipped.
      let friday = addDays(created, 7);
      while (friday.getUTCDay() !== 5) friday = addDays(friday, 1);
      const end = cancelled ?? (status === "paused" ? addDays(now, -between(10, 30)) : addDays(now, -3));
      for (; friday < end; friday = addDays(friday, 28)) {
        const date = day(friday);
        if (chance(0.12)) {
          boxTail.push(`insert into commerce.standing_deliveries (store_id, standing_order_id, delivery_date, outcome, created_at) values (${q(S)}, ${q(list)}, ${q(date)}, 'skipped', ${ts(addDays(friday, -2))});`);
          continue;
        }
        const o = newOrder(addDays(friday, -2), "NO", who, lines.map((l) => ({ p: l.p, quantity: l.quantity, unit: l.p.prices.NO })));
        boxOrders.push(o);
        boxTail.push(`insert into commerce.standing_deliveries (store_id, standing_order_id, delivery_date, outcome, order_id, left_out, created_at) values (${q(S)}, ${q(list)}, ${q(date)}, 'ordered', ${q(o.id)}, '[]'::jsonb, ${ts(o.at)});`);
      }
    }
    ordersFile("91-boxes.sql", boxHead, boxOrders, boxTail);

    // A wheel-throwing class: two hours, up to six at the wheel, Thursday evenings with Ingrid and Saturday mornings with Lars.
    const opened = new Date("2026-01-02T09:00:00Z");
    const classP = { id: uuid(), variant: uuid(), handle: "wheel-throwing-class", sku: "CLASS-WHEEL-2H", title: "Wheel-throwing class, 2 hours", prices: { NO: 95000, SE: 95000, DK: 69500 } };
    const ingrid = uuid();
    const lars = uuid();
    const week = (days) => ({ week: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, days[d] ?? null])), exceptions: [] });
    const classHead = [`insert into commerce.booking_resources (id, store_id, kind, name, email, hours, capacity, position, created_at, updated_at) values
  (${q(ingrid)}, ${q(S)}, 'staff', 'Ingrid', '', ${j(week({ thu: { open: "17:00", close: "21:00" } }))}, 6, 0, ${ts(opened)}, ${ts(opened)}),
  (${q(lars)}, ${q(S)}, 'staff', 'Lars', '', ${j(week({ sat: { open: "10:00", close: "15:00" } }))}, 6, 1, ${ts(opened)}, ${ts(opened)});
insert into commerce.products (id, store_id, handle, tax_code, kind, vat_category, delivery, withdrawal_exclusion, status, created_at, updated_at)
values (${q(classP.id)}, ${q(S)}, ${q(classP.handle)}, 'txcd_20030000', 'appointment', 'standard', 'service', 'dated_service', 'draft', ${ts(opened)}, ${ts(opened)});
insert into commerce.product_translations (store_id, product_id, locale, title, description)
values (${q(S)}, ${q(classP.id)}, ${q(markets.NO.locale)}, ${q(classP.title)}, 'Two hours at the wheel in our Oslo studio, for beginners and the curious. Clay, glaze and firing included; we post your pieces when they are fired.');
insert into commerce.product_media (store_id, product_id, url, position, alt) values (${q(S)}, ${q(classP.id)}, '/demo/themes/atelier/story.webp', 0, ${j({ [markets.NO.locale]: "Hands shaping clay on a potter's wheel" })});
insert into commerce.product_variants (id, store_id, product_id, sku, options, delivery, created_at) values (${q(classP.variant)}, ${q(S)}, ${q(classP.id)}, ${q(classP.sku)}, '{}', 'service', ${ts(opened)});
select commerce.set_price(${q(classP.variant)}, 'NO', 95000, ${ts(opened)}), commerce.set_price(${q(classP.variant)}, 'SE', 95000, ${ts(opened)}), commerce.set_price(${q(classP.variant)}, 'DK', 69500, ${ts(opened)});
insert into commerce.appointment_settings (product_id, store_id, duration_minutes, buffer_before_minutes, buffer_after_minutes, step_minutes, min_notice_minutes, max_days_ahead, payment, cancel_hours, no_show_percent)
values (${q(classP.id)}, ${q(S)}, 120, 0, 15, 30, 1440, 90, 'now', 48, 0);
insert into commerce.product_resources (store_id, product_id, resource_id) values (${q(S)}, ${q(classP.id)}, ${q(ingrid)}), (${q(S)}, ${q(classP.id)}, ${q(lars)});
update commerce.products set status = 'active', first_active_at = ${ts(opened)} where store_id = ${q(S)} and id = ${q(classP.id)};`];
    const classOrders = [];
    for (let d = new Date("2026-01-08T00:00:00Z"); d < addDays(now, 21); d = addDays(d, 1)) {
      const wd = d.getUTCDay();
      if (wd !== 4 && wd !== 6) continue;
      const [teacher, time] = wd === 4 ? [ingrid, "18:00"] : [lars, "11:00"];
      const seats = Math.min(6, poisson(d.getUTCMonth() === 10 || d.getUTCMonth() === 0 ? 1.8 : 1.3));
      for (let k = 0; k < seats; k += 1) {
        const at = addDays(d, -between(2, 20));
        if (at > now) continue;
        const who = pick(people.filter((p) => p.market === "NO" && p.since < at));
        if (!who) continue;
        const o = newOrder(addMinutes(at, between(400, 1300)), "NO", who, [{ p: classP, unit: 95000, quantity: 1, service: true, taxCode: "txcd_20030000" }], true);
        if (o.at > now) continue;
        const date = day(d);
        // Upcoming by its start (Oslo is UTC+1 in winter, +2 in summer; an hour early is close enough to say which side of now it is).
        const upcoming = addMinutes(d, (wd === 4 ? 17 : 10) * 60) > now;
        o.afterLines = `insert into commerce.bookings (store_id, product_id, variant_id, resource_id, starts_at, ends_at, blocked_from, blocked_to, status, order_id, order_line_id, created_at, updated_at, reminded_at)
values (${q(S)}, ${q(classP.id)}, ${q(classP.variant)}, ${q(teacher)}, ${oslo(date, time)}, ${oslo(date, time)} + interval '120 minutes', ${oslo(date, time)}, ${oslo(date, time)} + interval '135 minutes',
  'confirmed', ${q(o.id)}, ${q(o.lines[0].id)}, ${ts(o.at)}, ${ts(o.at)}, ${upcoming ? ts(o.at) : "null"});`;
        classOrders.push(o);
      }
    }
    ordersFile("92-classes.sql", classHead, classOrders, []);

    // A guest room above the studio, by the night; one stay at a time.
    const roomOpened = new Date("2026-03-01T09:00:00Z");
    const roomP = { id: uuid(), variant: uuid(), handle: "studio-guest-room", sku: "ROOM-STUDIO", title: "Studio guest room", prices: { NO: 85000, SE: 85000, DK: 62000 } };
    const room = uuid();
    const allDay = { open: "00:00", close: "23:59" };
    const roomHead = [`insert into commerce.booking_resources (id, store_id, kind, name, email, hours, capacity, position, created_at, updated_at)
values (${q(room)}, ${q(S)}, 'unit', 'Studio guest room', '', ${j(week({ mon: allDay, tue: allDay, wed: allDay, thu: allDay, fri: allDay, sat: allDay, sun: allDay }))}, 1, 2, ${ts(roomOpened)}, ${ts(roomOpened)});
insert into commerce.products (id, store_id, handle, tax_code, kind, vat_category, delivery, withdrawal_exclusion, status, created_at, updated_at)
values (${q(roomP.id)}, ${q(S)}, ${q(roomP.handle)}, 'txcd_20030000', 'stay', 'accommodation', 'service', 'dated_service', 'draft', ${ts(roomOpened)}, ${ts(roomOpened)});
insert into commerce.product_translations (store_id, product_id, locale, title, description)
values (${q(S)}, ${q(roomP.id)}, ${q(markets.NO.locale)}, ${q(roomP.title)}, 'A quiet room above the studio in Oslo, with a double bed, our own tableware and coffee in the morning. Check in from 15:00, out by 11:00.');
insert into commerce.product_media (store_id, product_id, url, position, alt) values (${q(S)}, ${q(roomP.id)}, '/demo/themes/atelier/hero.webp', 0, ${j({ [markets.NO.locale]: "Ceramics on a table in soft daylight" })});
insert into commerce.product_variants (id, store_id, product_id, sku, options, delivery, created_at) values (${q(roomP.variant)}, ${q(S)}, ${q(roomP.id)}, ${q(roomP.sku)}, '{}', 'service', ${ts(roomOpened)});
select commerce.set_price(${q(roomP.variant)}, 'NO', 85000, ${ts(roomOpened)}), commerce.set_price(${q(roomP.variant)}, 'SE', 85000, ${ts(roomOpened)}), commerce.set_price(${q(roomP.variant)}, 'DK', 62000, ${ts(roomOpened)});
insert into commerce.appointment_settings (product_id, store_id, min_notice_minutes, max_days_ahead, check_in_time, check_out_time, min_nights, max_nights, payment, deposit_percent, cancel_hours, booking_fee)
values (${q(roomP.id)}, ${q(S)}, 0, 365, '15:00', '11:00', 1, 14, 'now', 30, 72, '{}');
insert into commerce.product_resources (store_id, product_id, resource_id) values (${q(S)}, ${q(roomP.id)}, ${q(room)});
update commerce.products set status = 'active', first_active_at = ${ts(roomOpened)} where store_id = ${q(S)} and id = ${q(roomP.id)};`];
    const stayOrders = [];
    const ACC = { NO: 0.12, SE: 0.12, DK: 0.25 };
    for (let checkIn = addDays(roomOpened, between(10, 20)); checkIn < addDays(now, 40); ) {
      const nights = weighted([[1, 25], [2, 40], [3, 20], [4, 10], [6, 5]]);
      const market = weighted([["NO", 55], ["SE", 25], ["DK", 20]]);
      const at = addDays(checkIn, -between(5, 45));
      const who = pick(people.filter((p) => p.market === market && p.since < at));
      if (at <= now && who) {
        const price = roomP.prices[market] * nights;
        const o = newOrder(addMinutes(at, between(400, 1300)), market, who, [{ p: roomP, unit: price, quantity: 1, service: true, rate: ACC[market], nights, taxCode: "txcd_20030000" }], true);
        const inDay = day(checkIn);
        const outDay = day(addDays(checkIn, nights));
        o.afterLines = `insert into commerce.bookings (store_id, product_id, variant_id, resource_id, starts_at, ends_at, blocked_from, blocked_to, status, order_id, order_line_id, created_at, updated_at, reminded_at)
values (${q(S)}, ${q(roomP.id)}, ${q(roomP.variant)}, ${q(room)}, ${oslo(inDay, "15:00")}, ${oslo(outDay, "11:00")}, ${oslo(inDay, "15:00")}, ${oslo(outDay, "11:00")},
  'confirmed', ${q(o.id)}, ${q(o.lines[0].id)}, ${ts(o.at)}, ${ts(o.at)}, ${checkIn > now ? ts(o.at) : "null"});`;
        if (o.at <= now) stayOrders.push(o);
      }
      checkIn = addDays(checkIn, nights + between(2, 14));
    }
    ordersFile("93-stays.sql", roomHead, stayOrders, []);
  }

  function features2() {
    // Trade customers: four companies with their people and places, a trade price list, and orders on 30 days' terms, each paid in time.
    const companies = [
      ["Kafé Kollektivet AS", "923456781", "Oslo", "Markveien 35", "0554", ["Café", "Back office"]],
      ["Hotel Fjordlys AS", "918273645", "Bergen", "Strandkaien 12", "5013", ["Hotel", "Restaurant"]],
      ["Butikk Form AS", "927364518", "Oslo", "Bogstadveien 21", "0355", ["Shop"]],
      ["Bakeriet på hjørnet AS", "912837465", "Trondheim", "Kongens gate 8", "7011", ["Bakery"]],
    ];
    const listId = uuid();
    const head = [`insert into commerce.price_lists (id, store_id, name, percent, active, exclusive, created_at, updated_at) values (${q(listId)}, ${q(S)}, 'Trade prices', 15, true, false, ${ts(new Date("2026-02-01T09:00:00Z"))}, ${ts(new Date("2026-02-01T09:00:00Z"))});`];
    const termsOrders = [];
    for (const [name, number, city, street, postal, places] of companies) {
      const id = uuid();
      const since = addDays(new Date("2026-02-10T09:00:00Z"), between(0, 120));
      const owner = member(since);
      const staff = [member(since), ...(chance(0.6) ? [member(since)] : [])];
      head.push(`insert into commerce.customer_companies (id, store_id, name, organisation_number, payment_terms, credit_limit_minor, credit_currency, active, created_at, updated_at)
values (${q(id)}, ${q(S)}, ${q(name)}, ${q(number)}, 'net_30', 5000000, 'NOK', true, ${ts(since)}, ${ts(since)});
update commerce.customers set company_id = ${q(id)}, company_role = 'owner', company_name = ${q(name)}, organisation_number = ${q(number)} where store_id = ${q(S)} and id = ${q(owner.id)};
update commerce.customers set company_id = ${q(id)}, company_role = 'employee' where store_id = ${q(S)} and id in (${staff.map((p) => q(p.id)).join(", ")});
insert into commerce.price_list_assignments (store_id, list_id, company_id) values (${q(S)}, ${q(listId)}, ${q(id)});`);
      for (const place of places) {
        const loc = uuid();
        const address = { name: `${name}, ${place}`, line1: street, line2: null, postalCode: postal, city, country: "NO" };
        head.push(`insert into commerce.company_locations (id, store_id, company_id, name, billing_address, shipping_address, created_at, updated_at) values (${q(loc)}, ${q(S)}, ${q(id)}, ${q(place)}, ${j(address)}, ${j(address)}, ${ts(since)}, ${ts(since)});
insert into commerce.company_location_buyers (store_id, location_id, customer_id, role, created_at) values ${staff.map((p) => `(${q(S)}, ${q(loc)}, ${q(p.id)}, 'orderer', ${ts(since)})`).join(", ")};`);
      }
      for (let at = addDays(since, between(3, 20)); at < addDays(now, -35); at = addDays(at, between(25, 60))) {
        const items = new Set();
        const k = between(1, 3);
        while (items.size < k) items.add(weighted(products.map((x) => [x, x.weight])));
        const who = pick([owner, ...staff]);
        const o = newOrder(addMinutes(at, between(480, 960)), "NO", who, [...items].map((x) => ({ p: x, unit: Math.round(x.prices.NO * 0.85), list: x.prices.NO, quantity: x.handle === "moon-jar" ? 2 : between(4, 12) })));
        if (o.fate !== "delivered") continue;
        o.terms = { id, company: name, number };
        termsOrders.push(o);
      }
    }
    ordersFile("94-companies.sql", head, termsOrders, []);

    // Refer a friend: a dozen customers share their link; their friends' first orders earned them credits.
    const rf = [`insert into commerce.affiliate_settings (store_id, enabled, reward_bps, reward_orders, friend_percent, cookie_days, updated_at, updated_by)
values (${q(S)}, true, 500, 1, 10, 30, ${ts(new Date("2026-01-15T10:00:00Z"))}, ${q(ctx.owner)}) on conflict (store_id) do nothing;`];
    const toNok = { NOK: 1, SEK: 11.7 / 11.25, DKK: 11.7 / 7.46 };
    const programFrom = new Date("2026-01-15T10:00:00Z");
    const referrers = [];
    const codes = new Set();
    const firsts = built.filter((o) => o.at > addDays(programFrom, 5) && o.fate !== "unpaid" && o.fate !== "cancelled_paid" && o.buyer.orders[0].at === o.at && o.buyer.account && o.buyer.signedUp && o.buyer.signedUp <= o.at);
    const loyalBuyers = people.filter((p) => p.account && p.signedUp && p.signedUp < programFrom && p.orders.length >= 2);
    for (let i = 0; i < 12 && loyalBuyers.length; i += 1) {
      const p = pick(loyalBuyers);
      if (referrers.some((r) => r.p === p)) continue;
      let code = `${ascii(p.name.split(" ")[0]).replace(/[^a-z]/g, "")}${between(10, 99)}`;
      while (code.length < 6 || codes.has(code)) code += between(0, 9);
      codes.add(code);
      const joined = addDays(programFrom, between(0, 60));
      referrers.push({ p, code, joined });
      rf.push(`insert into commerce.affiliates (store_id, customer_id, code, created_at) values (${q(S)}, ${q(p.id)}, ${q(code)}, ${ts(joined)});`);
    }
    for (const o of firsts) {
      if (!chance(o.at > addDays(now, -30) ? 0.3 : 0.08)) continue;
      const r = pick(referrers.filter((x) => x.joined < addDays(o.at, -1) && x.p !== o.buyer));
      if (!r) continue;
      const reward = Math.floor((o.lines.reduce((s2, l) => s2 + l.total, 0) * 500 * toNok[markets[o.market].currency]) / 10000);
      if (reward <= 0) continue;
      const at = addMinutes(o.paidAt, 1);
      const available = addDays(at, 14);
      rf.push(`update commerce.customers set referred_by_customer_id = ${q(r.p.id)} where store_id = ${q(S)} and id = ${q(o.buyer.id)} and referred_by_customer_id is null;
insert into commerce.affiliate_attributions (store_id, order_id, affiliate_customer_id, friend_customer_id, code, discount_minor, reward_minor, status, rewarded_at, created_at)
values (${q(S)}, ${q(o.id)}, ${q(r.p.id)}, ${q(o.buyer.id)}, ${q(r.code)}, 0, ${reward}, 'rewarded', ${ts(at)}, ${ts(o.at)});
insert into commerce.bonus_entries (store_id, customer_id, kind, amount_minor, available_at, expires_at, note, idempotency_key, created_at)
values (${q(S)}, ${q(r.p.id)}, 'referral', ${reward}, ${ts(available)}, ${ts(addDays(available, 365))}, '', ${q(`referral:${o.id}`)}, ${ts(at)});`);
    }
    const visitRows = [];
    for (const r of referrers) {
      for (let d = new Date(r.joined); d < now; d = addDays(d, between(1, 6))) visitRows.push(`  (${q(S)}, ${q(r.code)}, ${q(day(d))}, ${between(1, 9)})`);
    }
    if (visitRows.length) rf.push(`insert into commerce.referral_visits (store_id, code, day, visits) values\n${visitRows.join(",\n")}\non conflict do nothing;`);
    file("95-referrals.sql", rf.join("\n"));

    // Two A/B tests on the front page, each run for three weeks and ended by the owner. Each runs in this one transaction, so no
    // visitor ever meets it running; neither is applied, so the live front page stays as it is.
    const tests = [
      { name: "A shorter headline on the front page", hypothesis: "Saying what we make in the headline gets more people to add a piece to the cart.", from: "Made slowly, for <em>everyday</em> rituals", to: "Handmade stoneware for <em>everyday</em> use", start: new Date("2026-05-04T08:00:00Z"), lift: [0.031, 0.036], learning: "The plainer headline added a little more to carts, but not enough to be sure. We kept the original voice." },
      { name: "Collection heading as a call to action", hypothesis: "A heading that invites people to shop leads more of them to checkout.", from: "Pieces for the table and the shelf", to: "Find a piece for your table", start: new Date("2026-08-24T08:00:00Z"), lift: [0.019, 0.017], learning: "No difference worth keeping: people found the collection either way." },
    ];
    const ab = [];
    tests.forEach((t, i) => {
      const id = uuid();
      const page = uuid();
      const end = addDays(t.start, 21);
      const slug = `ab-${id.slice(0, 8)}-b`;
      const visitors = 2600 + between(0, 900);
      ab.push(`-- ${t.name}
insert into commerce.experiments (id, store_id, name, hypothesis, target_page_id, status, primary_goal, goal_params, min_visitors, min_days, created_by, updated_by, created_at, updated_at)
values (${q(id)}, ${q(S)}, ${q(t.name)}, ${q(t.hypothesis)}, (select front_page_id from commerce.stores where id = ${q(S)}), 'draft', 'cart', '{}', 1000, 14, ${q(ctx.owner)}, ${q(ctx.owner)}, ${ts(addDays(t.start, -2))}, ${ts(addDays(t.start, -2))});
insert into commerce.pages (id, store_id, slug, type, draft, published, published_at, first_published_at, created_at, created_by, updated_at, updated_by)
select ${q(page)}, ${q(S)}, ${q(slug)}, 'variant', v.content, v.content, ${ts(addDays(t.start, -1))}, ${ts(addDays(t.start, -1))}, ${ts(addDays(t.start, -2))}, ${q(ctx.owner)}, ${ts(addDays(t.start, -1))}, ${q(ctx.owner)}
from commerce.pages f, lateral (select jsonb_set(jsonb_set(replace(f.published::text, ${q(JSON.stringify(t.from).slice(1, -1))}, ${q(JSON.stringify(t.to).slice(1, -1))})::jsonb, '{slug}', to_jsonb(${q(slug)}::text)), '{title}', to_jsonb(coalesce(f.published ->> 'title', 'Front page') || ' (B)')) as content) v
where f.id = (select front_page_id from commerce.stores where id = ${q(S)});
insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share) values (${q(S)}, ${q(id)}, 'a', 'Original', null, 0.5), (${q(S)}, ${q(id)}, 'b', 'Version B', ${q(page)}, 0.5);
update commerce.experiments set status = 'running', started_at = ${ts(t.start)}, planned_end = ${ts(end)}, updated_at = ${ts(t.start)} where store_id = ${q(S)} and id = ${q(id)};
select setseed(${(0.11 + i * 0.37).toFixed(2)});
insert into commerce.experiment_exposures (store_id, experiment_id, visitor, variant, market, device, "returning", first_seen)
select ${q(S)}, ${q(id)}, substr(md5(${q(id)} || g::text), 1, 22), case when random() < 0.5 then 'a' else 'b' end,
  (array['NO','NO','NO','NO','SE','SE','DK'])[1 + floor(random() * 7)::int], (array['mobile','mobile','mobile','desktop','desktop','tablet'])[1 + floor(random() * 6)::int],
  random() < 0.22, ${ts(t.start)} + random() * interval '21 days'
from generate_series(1, ${visitors}) g;
insert into commerce.experiment_events (store_id, experiment_id, visitor, variant, goal, ref, occurred_at)
select e.store_id, e.experiment_id, e.visitor, e.variant, 'cart', '', e.first_seen + interval '3 minutes'
from commerce.experiment_exposures e where e.experiment_id = ${q(id)} and random() < case e.variant when 'a' then ${t.lift[0]} else ${t.lift[1]} end;
insert into commerce.experiment_events (store_id, experiment_id, visitor, variant, goal, ref, occurred_at)
select e.store_id, e.experiment_id, e.visitor, e.variant, 'checkout', '', e.occurred_at + interval '4 minutes'
from commerce.experiment_events e where e.experiment_id = ${q(id)} and e.goal = 'cart' and random() < 0.55;
update commerce.experiments set status = 'stopped', stopped_at = ${ts(end)}, stop_reason = 'person', updated_at = ${ts(end)} where store_id = ${q(S)} and id = ${q(id)};
update commerce.experiments set status = 'discarded', learning = ${q(t.learning)}, updated_at = ${ts(addMinutes(end, 30))} where store_id = ${q(S)} and id = ${q(id)};`);
    });
    file("96-ab-tests.sql", ab.join("\n"));
  }

  features();
  features2();

  out.summary = {
    orders: built.length,
    paid: built.filter((o) => o.fate !== "unpaid").length,
    people: people.length,
    accounts: people.filter((p) => p.account).length,
    subscribers: subs.length,
    returns: built.filter((o) => o.fate === "returned").length,
    refunds: built.filter((o) => o.fate === "partial_refund" || o.fate === "cancelled_paid").length,
    toSend: built.filter((o) => o.fate === "paid").length,
    stock,
  };
  return out;
}

// --- Phase two: what people did besides buying, and what the store did for them --------------------------------------------------------

const REVIEW_WORDS = {
  5: [["Beautiful", "Even nicer in real life. The glaze has so much depth."], ["Perfect gift", "Bought it for my mother and she loved it. Lovely packaging too."], ["Love it", "Use it every day. Feels great in the hand."], ["Gorgeous", "Exactly as pictured, and it arrived quickly."], [null, "Wonderful craftsmanship. Will buy more."]],
  4: [["Very nice", "Lovely piece, a little smaller than I expected."], ["Happy", "Beautiful glaze. Delivery took a few days longer than promised."], [null, "Nice quality, good packaging."]],
  3: [["OK", "Nice, but the colour is more grey than on the pictures."], [null, "Fine, though a bit pricey for the size."]],
  2: [["Not quite", "Arrived with a small chip on the base. Customer service sorted it out."]],
  1: [["Disappointed", "It broke in the post. Got a refund, but sad about the piece."]],
};
const ANSWERS = {
  5: "Thank you so much! It makes our day to hear it found a good home.",
  4: "Thank you for the kind words, and for letting us know about the size. We have added measurements to the page.",
  3: "Thank you for the honest review. Glazes vary from kiln to kiln; write to us if you would like to swap it.",
  2: "We are sorry it arrived chipped and glad we could make it right. We have changed how we pack this piece.",
  1: "We are so sorry. We have improved our packaging since, and hope you give us another try.",
};
const SUPPORT = [
  { topic: "order_status", title: "Where is my order?", ask: "Hi! I ordered last week and haven't received a tracking link yet. Can you check?", answer: "Hi! Your parcel left our studio yesterday. The tracking link is in your email; it should reach you within two days.", outcome: "resolved" },
  { topic: "delivery", title: "Delivery to a pickup point", ask: "Can I have my order sent to a pickup point instead of my home address?", answer: "Of course. We have changed the delivery to your nearest pickup point, and you get a text when it is ready.", outcome: "resolved" },
  { topic: "returns", title: "Returning a vase", ask: "The tall vase is lovely but too big for our shelf. How do I return it?", answer: "No problem. You can start a return from your order page, and we refund as soon as it is back with us.", outcome: "resolved" },
  { topic: "product_question", title: "Dishwasher safe?", ask: "Are the cups dishwasher safe?", answer: "Yes, all our tableware is dishwasher and microwave safe. Hand washing keeps the glaze glossy for longer.", outcome: "resolved" },
  { topic: "availability", title: "Moon jar back in stock?", ask: "When will the moon jar be back in stock?", answer: "The next firing is in two weeks. Sign up on the product page and we email you the moment it is back.", outcome: "follow_up" },
  { topic: "complaint", title: "Bowl arrived chipped", ask: "My ridged bowl arrived with a chip on the rim. Very sad, it was a gift.", answer: "We are so sorry! We are sending a new bowl today at no cost, and you can keep the chipped one.", outcome: "resolved" },
  { topic: "discount", title: "Code did not work", ask: "The code from your newsletter says it is not valid.", answer: "Sorry about that, the code ended on Sunday. We have refunded the difference to your card as a thank you for your patience.", outcome: "resolved" },
  { topic: "product_question", title: "Custom glaze for a wedding", ask: "Do you make sets in a custom colour? We are looking for 40 cups for our wedding.", answer: "We would love to! Custom orders take about six weeks. I have sent you an email with colours and prices.", outcome: "follow_up" },
  { topic: "payment", title: "Paying with Klarna", ask: "Can I pay later with Klarna?", answer: "Yes, Klarna is offered at checkout in all three countries.", outcome: "resolved" },
  { topic: "account", title: "Changing my email", ask: "How do I change the email on my account?", answer: "Go to My account, then Details. You confirm the new address with a code we email you.", outcome: "resolved" },
];
const DEALS = [
  ["Kafé Kollektivet: cups for the new café", "Oslo", 48000], ["Hotel Fjordlys: tableware for 40 rooms", "Bergen", 186000], ["Studio Linnea: interior project", "Stockholm", 62000],
  ["Restaurant Havn: serving dishes", "Copenhagen", 74000], ["Nordisk Interiør: wholesale autumn", "Trondheim", 95000], ["Café Saga: espresso cups", "Göteborg", 31000],
  ["Bakeriet på hjørnet: plates and bowls", "Oslo", 27000], ["Galleri Ljus: exhibition pieces", "Copenhagen", 58000], ["Hotell Nord: breakfast service", "Tromsø", 112000],
  ["Lunsj & Lyst: cups and pitchers", "Stavanger", 22000], ["Butikk Form: consignment", "Oslo", 40000], ["Brasserie Blå: Christmas menu", "Oslo", 36000],
  ["Designbyrå Vik: client gifts", "Bergen", 19000], ["Spa Tid: candle holders", "Drammen", 15000], ["Konferansehotellet: table vases", "Lillehammer", 54000],
];

function engagement({ S, start, now, markets, products, people, built, subs, file, ctx }) {
  const owner = ctx.owner;
  const buyers = people.filter((p) => p.orders.length > 0);
  const accounts = people.filter((p) => p.account && p.signedUp);
  const spent = (p) => built.filter((o) => o.buyer === p && o.fate !== "unpaid").length;
  const sql = [];

  // Customer groups, tags and notes, segments.
  const vip = uuid();
  const trade = uuid();
  sql.push(`insert into commerce.customer_tiers (id, store_id, name, percent, note, active, created_at) values
  (${q(vip)}, ${q(S)}, 'Studio friends', 10, 'Our most loyal customers: four orders or more.', true, ${ts(addDays(start, 60))}),
  (${q(trade)}, ${q(S)}, 'Trade', 15, 'Cafés, restaurants and interior shops buying for their business.', true, ${ts(addDays(start, 90))});`);
  const loyal = accounts.filter((p) => spent(p) >= 4);
  if (loyal.length) sql.push(`update commerce.customers set tier_id = ${q(vip)} where store_id = ${q(S)} and id in (${loyal.map((p) => q(p.id)).join(", ")});`);
  const tagRows = [];
  const noteRows = [];
  for (const p of buyers) {
    if (spent(p) >= 4) tagRows.push([p.email, "vip", "VIP"]);
    if (chance(0.04)) tagRows.push([p.email, "gift-buyer", "Gift buyer"]);
    if (chance(0.015)) tagRows.push([p.email, "interior-designer", "Interior designer"]);
    if (chance(0.012)) noteRows.push([p.email, pick(["Prefers delivery after 16:00.", "Ordered as a wedding gift; wrap in paper next time.", "Collector of moon jars: tell her about the next firing.", "Had a chipped bowl in the spring, replaced. Pack extra carefully.", "Met at the Christmas market in Oslo."])]);
  }
  if (tagRows.length) sql.push(`insert into commerce.customer_tags (store_id, email, key, label, created_by, created_at) values\n${tagRows.map(([e, k, l]) => `  (${q(S)}, ${q(e)}, ${q(k)}, ${q(l)}, ${q(owner)}, ${ts(addDays(now, -between(1, 200)))})`).join(",\n")}\non conflict do nothing;`);
  if (noteRows.length) sql.push(`insert into commerce.customer_notes (store_id, email, body, created_by, created_at) values\n${noteRows.map(([e, b]) => `  (${q(S)}, ${q(e)}, ${q(b)}, ${q(owner)}, ${ts(addDays(now, -between(1, 250)))})`).join(",\n")};`);
  const segments = [
    ["Your best customers", { match: "all", conditions: [{ kind: "rfm", groups: ["VIP", "Loyal"] }] }],
    ["Good customers gone quiet", { match: "all", conditions: [{ kind: "rfm", groups: ["At risk"] }] }],
    ["Ordered once", { match: "all", conditions: [{ kind: "orders", op: "exactly", value: 1 }] }],
    ["Subscribed but never bought", { match: "all", conditions: [{ kind: "consent", statuses: ["subscribed"] }, { kind: "lastOrder", op: "never" }] }],
  ];
  const segmentIds = segments.map(() => uuid());
  sql.push(`insert into commerce.segments (id, store_id, title, rules, created_by, created_at, updated_at) values\n${segments.map(([t, r], i) => `  (${q(segmentIds[i])}, ${q(S)}, ${q(t)}, ${j(r)}, ${q(owner)}, ${ts(addDays(start, 70 + i * 40))}, ${ts(addDays(start, 70 + i * 40))})`).join(",\n")};`);

  // Privacy requests: three exports, answered within days.
  for (const p of buyers.filter(() => chance(0.004)).slice(0, 3)) {
    const at = addDays(now, -between(20, 300));
    sql.push(`insert into commerce.privacy_requests (store_id, kind, channel, status, subject_customer_id, subject_email, received_at, due_at, completed_at, outcome, handled_by, created_at, updated_at)
values (${q(S)}, 'export', 'shopper', 'done', ${q(p.account && p.signedUp ? p.id : null)}, ${q(p.email)}, ${ts(at)}, ${ts(addDays(at, 30))}, ${ts(addDays(at, between(1, 6)))}, 'exported', ${q(owner)}, ${ts(at)}, ${ts(addDays(at, 6))});`);
  }
  file("70-customers-more.sql", sql.join("\n"));

  // Reviews: about one delivered order in five, a few days after delivery.
  const rv = [`select set_config('kaizen.review_writer', 'author', true);`];
  const reviewed = new Set();
  for (const o of built) {
    if (o.fate !== "delivered" && o.fate !== "returned" && o.fate !== "partial_refund") continue;
    if (!chance(o.fate === "partial_refund" ? 0.5 : 0.2)) continue;
    const l = pick(o.lines);
    const who = o.buyer.account && o.buyer.signedUp && o.buyer.signedUp <= o.at ? `c:${o.buyer.id}` : `e:${createHash("sha256").update(o.buyer.email.toLowerCase()).digest("hex")}`;
    if (reviewed.has(`${l.p.id}:${who}`)) continue;
    reviewed.add(`${l.p.id}:${who}`);
    const rating = o.fate === "partial_refund" ? pick([1, 2, 2, 3]) : weighted([[5, 62], [4, 25], [3, 8], [2, 3], [1, 2]]);
    const [title, body] = pick(REVIEW_WORDS[rating]);
    const at = addDays(o.deliveredAt, between(2, 15));
    if (at > now) continue;
    const id = uuid();
    const [first, last] = o.buyer.name.split(" ");
    rv.push(`insert into commerce.product_reviews (id, store_id, product_id, variant_id, source, order_id, order_line_id, buyer_key, customer_id, author_name, rating, title, body, locale, status, created_at)
values (${q(id)}, ${q(S)}, ${q(l.p.id)}, ${q(l.p.variant)}, 'buyer', ${q(o.id)}, ${q(l.id)}, ${q(who)}, ${q(who.startsWith("c:") ? o.buyer.id : null)}, ${q(`${first} ${last[0]}.`)}, ${rating}, ${q(title)}, ${q(body)}, 'en-GB', 'pending', ${ts(at)});`);
    const moderated = addMinutes(at, between(90, 2000));
    if (moderated > now) continue;
    const hide = chance(0.03);
    rv.push(`update commerce.product_reviews set status = ${q(hide ? "hidden" : "published")}, hidden_reason = ${q(hide ? "personal_data" : null)}, moderated_at = ${ts(moderated)}, moderated_by = ${q(owner)}${
      !hide && (rating <= 3 || chance(0.2)) ? `, answer = ${q(ANSWERS[rating])}, answered_at = ${ts(addMinutes(moderated, 5))}, answered_by = ${q(owner)}` : ""
    } where store_id = ${q(S)} and id = ${q(id)};`);
  }
  rv.push(`insert into commerce.review_settings (store_id, publish, requests_on, requests_enabled_at, request_days) values (${q(S)}, 'after_check', true, ${ts(addDays(start, 30))}, 10)
  on conflict (store_id) do update set publish = excluded.publish, requests_on = excluded.requests_on, requests_enabled_at = excluded.requests_enabled_at, request_days = excluded.request_days;`);
  file("71-reviews.sql", rv.join("\n"));

  // Support: a person answers every conversation; all are finished, summarised and rated.
  const sp = [`insert into commerce.support_settings (store_id, mode, summaries_on, transcript_days, email_followup) values (${q(S)}, 'people', true, 90, true)
  on conflict (store_id) do update set mode = 'people', summaries_on = true, transcript_days = 90;`,
    `select set_config('kaizen.support_writer', 'on', true);`, `select set_config('kaizen.support_transition', 'on', true);`];
  const withOrders = built.filter((o) => o.fate !== "unpaid");
  for (let i = 0; i < 230; i += 1) {
    const at = new Date(start.getTime() + Math.pow(rand(), 0.85) * (now - start - 86_400_000));
    const near = withOrders.filter((o) => Math.abs(o.at - at) < 20 * 86_400_000);
    const o = near.length ? pick(near) : pick(withOrders);
    const p = o.buyer;
    const t = pick(SUPPORT);
    const source = weighted([["site", 55], ["email", 35], ["form", 10]]);
    const id = uuid();
    const claimed = addMinutes(at, between(3, 240));
    const answered = addMinutes(claimed, between(1, 15));
    const thanks = chance(0.7);
    const end = addMinutes(answered, thanks ? between(5, 600) : between(30, 1440));
    const rating = source === "site" ? (chance(0.85) ? "good" : chance(0.5) ? "bad" : null) : null;
    const messages = [["customer", t.ask, at, null], ["agent", t.answer, answered, owner]];
    if (thanks) messages.push(["customer", pick(["Thank you so much!", "Perfect, thanks!", "Great, thank you for the quick answer.", "Thanks!"]), addMinutes(answered, between(2, 300)), null]);
    const n = messages.length;
    const summary = { title: t.title, text: `${p.name.split(" ")[0]} asked: ${t.ask} We answered: ${t.answer}`, outcome: t.outcome, topics: [t.topic], followUp: t.outcome === "follow_up" ? "Check back with the customer." : null, at: end.toISOString() };
    sp.push(`insert into commerce.support_conversations (id, store_id, source, status, handler, customer_id, locale, contact_name, contact_email, token_hash, email_subject, message_seq, created_at, queued_at, desk_mode)
values (${q(id)}, ${q(S)}, ${q(source)}, 'open', 'queue', ${q(p.account && p.signedUp && p.signedUp <= at ? p.id : null)}, 'en-GB', ${q(p.name)}, ${q(p.email)}, ${q(source === "site" ? hex(64) : null)}, ${q(source === "email" ? t.title : null)}, 0, ${ts(at)}, ${ts(at)}, 'people');
insert into commerce.support_messages (conversation_id, store_id, seq, author, account_id, body, created_at) values
${messages.map(([author, body, when, acc], k) => `  (${q(id)}, ${q(S)}, ${k + 1}, ${q(author)}, ${q(acc)}, ${q(body)}, ${ts(when)})`).join(",\n")};
update commerce.support_conversations set message_seq = ${n}, status = 'ended', handler = 'human', assignee_id = null, claimed_at = ${ts(claimed)}, first_agent_at = ${ts(answered)},
  last_message_at = ${ts(messages[n - 1][2])}, last_customer_at = ${ts(messages.filter((m) => m[0] === "customer").at(-1)[2])}, ended_at = ${ts(end)}, ended_by = ${q(thanks ? "agent" : "timeout")},
  summary = ${j(summary)}, summary_status = 'done', rating = ${q(rating)}, email_sent_seq = ${n}, email_count = ${source === "site" ? 0 : 1}, visitor_seen_at = ${ts(end)}, created_at = ${ts(at)}
 where store_id = ${q(S)} and id = ${q(id)};`);
  }
  sp.push(`insert into commerce.support_replies (store_id, title, body, shortcut, locale, created_by) values
  (${q(S)}, 'Tracking link', 'Your parcel is on its way. You find the tracking link in the email we sent when it left the studio.', 'track', 'en-GB', ${q(owner)}),
  (${q(S)}, 'Dishwasher safe', 'All our tableware is dishwasher and microwave safe. Hand washing keeps the glaze glossy for longer.', 'dish', 'en-GB', ${q(owner)}),
  (${q(S)}, 'Back in stock', 'The next firing is in about two weeks. Sign up on the product page and we email you the moment it is back.', 'stock', 'en-GB', ${q(owner)});`);
  file("72-support.sql", sp.join("\n"));

  // Wishlists, loyalty points, gift cards.
  const more = [];
  const wl = accounts.filter(() => chance(0.22));
  for (const p of wl) {
    const id = uuid();
    const at = addDays(p.signedUp, between(0, 60));
    if (at > now) continue;
    const items = new Set();
    const k = between(1, 4);
    while (items.size < k) items.add(weighted(products.map((x) => [x, x.weight + 6])));
    more.push(`insert into commerce.wishlists (id, store_id, customer_id, name, created_at, updated_at) values (${q(id)}, ${q(S)}, ${q(p.id)}, 'Wishlist', ${ts(at)}, ${ts(at)});
insert into commerce.wishlist_items (store_id, wishlist_id, product_id, variant_id, quantity, created_at) values
${[...items].map((x, i) => `  (${q(S)}, ${q(id)}, ${q(x.id)}, ${q(x.variant)}, 1, ${ts(addMinutes(at, i * between(5, 9000)))})`).join(",\n")};`);
  }
  const bonusFrom = new Date("2026-03-01T00:00:00Z");
  more.push(`insert into commerce.bonus_settings (store_id, enabled, earn_bps, pending_days, max_redeem_percent, min_redeem_minor, expires_months, currency, levels, signup_minor, birthday_minor)
values (${q(S)}, true, 500, 14, 50, 5000, 12, 'NOK', '[]'::jsonb, 0, 0) on conflict (store_id) do nothing;`);
  const toNok = { NOK: 1, SEK: 11.7 / 11.25, DKK: 11.7 / 7.46 };
  const lots = new Map();
  const earnRows = [];
  for (const o of built) {
    if (o.at < bonusFrom || o.fate === "unpaid" || o.fate === "cancelled_paid") continue;
    const p = o.buyer;
    if (!(p.account && p.signedUp && p.signedUp <= o.at)) continue;
    const amount = Math.round(((o.total - o.tax) * 0.05 * toNok[markets[o.market].currency]) / 100) * 100;
    if (amount <= 0) continue;
    const id = uuid();
    const available = addDays(o.paidAt, 14);
    earnRows.push(`  (${q(id)}, ${q(S)}, ${q(p.id)}, 'earn', ${amount}, ${q(o.id)}, ${ts(available)}, ${ts(addDays(available, 365))}, ${q(`earn:${o.id}`)}, ${ts(o.paidAt)})`);
    if (!lots.has(p.id)) lots.set(p.id, []);
    lots.get(p.id).push({ id, amount, available });
  }
  if (earnRows.length) more.push(`insert into commerce.bonus_entries (id, store_id, customer_id, kind, amount_minor, order_id, available_at, expires_at, idempotency_key, created_at) values\n${earnRows.join(",\n")};`);
  // Some spend what they earned on a later order.
  for (const [customer, list] of lots) {
    const lot = list.find((l) => l.available < addDays(now, -5) && l.amount >= 5000);
    if (!lot || !chance(0.45)) continue;
    const entry = uuid();
    const use = Math.min(lot.amount, 5000 + 100 * between(0, 40));
    const at = addDays(lot.available, between(3, 60));
    if (at > now) continue;
    more.push(`insert into commerce.bonus_entries (id, store_id, customer_id, kind, amount_minor, note, idempotency_key, created_at) values (${q(entry)}, ${q(S)}, ${q(customer)}, 'redeem', ${-use}, 'Used at checkout', ${q(`demo-redeem:${entry}`)}, ${ts(at)});
insert into commerce.bonus_allocations (store_id, lot_id, entry_id, amount_minor) values (${q(S)}, ${q(lot.id)}, ${q(entry)}, ${use});`);
  }
  more.push(`select set_config('kaizen.gift_card_ledger', 'on', true);`);
  for (let i = 0; i < 48; i += 1) {
    const at = new Date(start.getTime() + rand() * (now - start - 3 * 86_400_000));
    const id = uuid();
    const amount = pick([50000, 50000, 75000, 100000, 100000, 150000]);
    const to = pick(people);
    const code = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(rand() * 32)]).join("");
    more.push(`insert into commerce.gift_cards (id, store_id, code_hash, last4, currency, initial_minor, source, issued_by, note, status, test_mode, recipient_email, recipient_name, send_at, sent_at, issued_at, expires_at, created_at)
values (${q(id)}, ${q(S)}, ${q(hex(64))}, ${q(code)}, 'NOK', ${amount}, 'staff', ${q(owner)}, ${q(pick(["Sold at the Christmas market", "Sold in the studio shop", "Goodwill after a broken parcel", "Raffle prize, Grünerløkka street fair", "Sold in the studio shop"]))}, 'active', true,
  ${q(to.email)}, ${q(to.name)}, ${ts(at)}, ${ts(at)}, ${ts(at)}, ${ts(addDays(at, 3 * 365))}, ${ts(at)});
insert into commerce.gift_card_entries (store_id, card_id, kind, amount_minor, account_id, idempotency_key, created_at) values (${q(S)}, ${q(id)}, 'issue', ${amount}, ${q(owner)}, ${q(`demo-issue:${id}`)}, ${ts(at)});`);
  }
  file("73-loyalty-gift-cards.sql", more.join("\n"));

  // Sales: a pipeline of trade deals with their calls and meetings.
  const dl = [];
  const pipeline = uuid();
  const stages = [["New lead", 10, false], ["In talks", 30, false], ["Samples sent", 50, false], ["Offer sent", 70, true]].map(([name, prob, quote], i) => ({ id: uuid(), name, prob, quote, position: i + 1 }));
  dl.push(`insert into commerce.deal_pipelines (id, store_id, name, sort, created_at) values (${q(pipeline)}, ${q(S)}, 'Trade', 0, ${ts(addDays(start, 75))});
insert into commerce.deal_stages (id, store_id, pipeline_id, name, position, probability, quote_stage, created_at) values
${stages.map((st) => `  (${q(st.id)}, ${q(S)}, ${q(pipeline)}, ${q(st.name)}, ${st.position}, ${st.prob}, ${st.quote}, ${ts(addDays(start, 75))})`).join(",\n")};`);
  const dealIds = [];
  DEALS.forEach(([title, city, estimate], i) => {
    const id = uuid();
    dealIds.push(id);
    // Older deals are decided; the last few months' are still open, each touched lately.
    const created = i < 9 ? addDays(start, 70 + i * 32 + between(0, 10)) : addDays(now, -between(6, 80));
    const status = created < addDays(now, -90) ? weighted([["won", 65], ["lost", 35]]) : "open";
    const stage = status === "open" ? pick(stages) : stages[3];
    const closed = status === "open" ? null : addDays(created, between(14, 70));
    const company = title.split(":")[0];
    const contact = { first: pick(FIRST.NO), last: pick(LAST.NO) };
    const cid = uuid();
    const email = `${ascii(contact.first)}@${ascii(company).replace(/[^a-z]/g, "")}.example.org`;
    dl.push(`insert into commerce.customers (id, store_id, email, locale, name, phone, address, company_name, created_at, updated_at) values (${q(cid)}, ${q(S)}, ${q(email)}, 'en-GB', ${q(`${contact.first} ${contact.last}`)}, '', ${j({ name: company, line1: null, line2: null, postalCode: null, city, country: null, phone: null })}, ${q(company)}, ${ts(created)}, ${ts(created)})
  on conflict do nothing;
insert into commerce.deals (id, store_id, title, customer_id, owner_id, pipeline_id, stage_id, status, estimate_minor, currency, expected_close_on, closed_at, closed_via, close_reason, stage_entered_at, created_by, created_at, updated_at)
values (${q(id)}, ${q(S)}, ${q(title)}, ${q(cid)}, ${q(owner)}, ${q(pipeline)}, ${q(stage.id)}, ${q(status)}, ${estimate * 100}, 'NOK', ${q(day(addDays(created, 45)))}, ${closed ? ts(closed) : "null"}, ${closed ? "'person'" : "null"},
  ${q(status === "lost" ? pick(["Went with a cheaper supplier", "Project postponed", "Needed it sooner than we could make it"]) : null)}, ${ts(addDays(created, Math.min(between(1, 20), Math.max(1, Math.floor((now - created) / 86_400_000) - 1))))}, ${q(owner)}, ${ts(created)}, ${ts(closed ?? created)});
update commerce.deal_moves set at = ${ts(created)} where store_id = ${q(S)} and deal_id = ${q(id)};
update commerce.deals set stage_entered_at = ${ts(addDays(created, Math.min(between(1, 20), Math.max(1, Math.floor((now - created) / 86_400_000) - 1))))} where store_id = ${q(S)} and id = ${q(id)};
insert into commerce.activities (store_id, kind, title, note, due_at, timed, duration_minutes, assignee_id, customer_id, deal_id, done_at, done_by, created_by, created_at) values
  (${q(S)}, 'call', ${q(`First call with ${contact.first}`)}, 'Talked through quantities and timing.', ${ts(addDays(created, 1))}, false, null, ${q(owner)}, ${q(cid)}, ${q(id)}, ${ts(addDays(created, 1))}, ${q(owner)}, ${q(owner)}, ${ts(created)}),
  (${q(S)}, 'meeting', ${q(`Studio visit: ${company}`)}, 'Showed glazes and samples.', ${ts(addDays(created, 8))}, true, 60, ${q(owner)}, ${q(cid)}, ${q(id)}, ${ts(addDays(created, 8))}, ${q(owner)}, ${q(owner)}, ${ts(addDays(created, 2))})${
    status === "open" ? `,\n  (${q(S)}, 'task', ${q(`Follow up with ${contact.first}`)}, null, ${ts(addDays(now, between(1, 10)))}, false, null, ${q(owner)}, ${q(cid)}, ${q(id)}, null, null, ${q(owner)}, ${ts(addDays(now, -2))})` : ""
  };`);
  });
  file("74-deals.sql", dl.join("\n"));

  // Email marketing: automations with three months of sends, two flows, a year of newsletters, cart reminders.
  const mk = [];
  const enabledAt = addDays(start, 16);
  const content = (subject, preview, heading, text, button, url) => ({ "en-GB": { subject, preview, blocks: [{ type: "heading", text: heading }, { type: "paragraph", text }, { type: "button", text: button, url }] } });
  const autos = [
    ["welcome", true, 0, content("Welcome to the studio", "Thank you for joining our list.", "Welcome", "Thank you for joining. We write when a new firing comes out of the kiln, and before our studio sales. Here is 10 % off your first order with the code WELCOME10.", "See the pieces", "/products")],
    ["after_purchase", true, 7, content("How is your new piece?", "We hope it arrived safe and sound.", "Thank you for your order", "We hope everything arrived as it should. Every piece is thrown by hand, so tell us how you like it. If anything is not right, reply to this email.", "Visit the studio", "/")],
    ["cross_sell", true, 14, content("Goes well with what you bought", "A few pieces our customers pair with yours.", "Made to go together", "Our glazes are made to be mixed. Here are a few pieces that sit well next to what you bought.", "See more", "/products")],
    ["win_back", false, 90, content("We miss you", "A lot has come out of the kiln since last time.", "It has been a while", "A lot has come out of the kiln since your last visit. Come and have a look.", "See what is new", "/products")],
  ];
  mk.push(`insert into commerce.automations (store_id, kind, enabled, enabled_at, delay_days, content, updated_by, created_at, updated_at) values
${autos.map(([kind, on, delay, c]) => `  (${q(S)}, ${q(kind)}, ${on}, ${on ? ts(enabledAt) : "null"}, ${delay}, ${j(c)}, ${q(owner)}, ${ts(enabledAt)}, ${ts(enabledAt)})`).join(",\n")},
  (${q(S)}, 'back_in_stock', true, ${ts(enabledAt)}, null, null, ${q(owner)}, ${ts(enabledAt)}, ${ts(enabledAt)})
on conflict do nothing;`);
  const subOf = new Map(subs.map((x) => [x.p.email, x]));
  const sends = [];
  const since = addDays(now, -88);
  for (const x of subs) {
    if (x.at >= since && x.at <= now) sends.push([`welcome:${x.id}`, "welcome", x.id, null, addMinutes(x.at, between(1, 6))]);
  }
  for (const o of built) {
    if (!o.deliveredAt) continue;
    const x = subOf.get(o.buyer.email);
    if (!x || x.at > o.deliveredAt) continue;
    for (const [kind, delay] of [["after_purchase", 7], ["cross_sell", 14]]) {
      const at = addMinutes(addDays(o.deliveredAt, delay), between(5, 600));
      if (at >= since && at <= now) sends.push([`${kind}:${o.id}`, kind, x.id, o.id, at]);
    }
  }
  if (sends.length) {
    for (let i = 0; i < sends.length; i += 800) {
      mk.push(`insert into commerce.automation_sends (store_id, key, kind, subscriber_id, order_id, outcome, created_at, step) values\n${sends.slice(i, i + 800).map(([key, kind, sub, order, at]) => `  (${q(S)}, ${q(key)}, ${q(kind)}, ${q(sub)}, ${q(order)}, 'sent', ${ts(at)}, 1)`).join(",\n")}\non conflict do nothing;`);
    }
  }
  const welcomeFlow = uuid();
  const backFlow = uuid();
  const mail = (id, subject, text) => ({ id, kind: "email", content: { "en-GB": { subject, preview: "", blocks: [{ type: "paragraph", text }] } } });
  mk.push(`insert into commerce.flows (id, store_id, name, trigger, enabled, version, tested_version, replaces, trigger_days, enabled_at, created_at, updated_at) values
  (${q(welcomeFlow)}, ${q(S)}, 'Welcome series', 'subscriber.subscribed', false, 1, null, 'welcome', null, null, ${ts(addDays(now, -9))}, ${ts(addDays(now, -9))}),
  (${q(backFlow)}, ${q(S)}, 'Bring back customers', 'customer.lapsed', true, 1, 1, 'win_back', 90, ${ts(addDays(now, -60))}, ${ts(addDays(now, -65))}, ${ts(addDays(now, -60))});
insert into commerce.flow_versions (store_id, flow_id, version, steps, goals, created_at) values
  (${q(S)}, ${q(welcomeFlow)}, 1, ${j([mail("welcome", "Welcome to the studio", "Thank you for joining! Here is 10 % off your first order with the code WELCOME10."), { id: "wait-3d", kind: "wait", hours: 72 }, { id: "ordered", kind: "if", condition: { kind: "ordered_since_entry" }, then: [mail("thanks", "Thank you", "Thank you for your first order. We hope you love it.")], else: [mail("best", "Our best sellers", "Not sure where to start? These are the pieces our customers love most.")] }])}, '[]'::jsonb, ${ts(addDays(now, -9))}),
  (${q(S)}, ${q(backFlow)}, 1, ${j([mail("miss", "We miss you", "A lot has come out of the kiln since your last visit. Come and have a look."), { id: "wait-14d", kind: "wait", hours: 336 }, mail("last", "Still here for you", "A new firing of moon jars is in the shop this week. Perhaps something for you?")])}, ${j([{ kind: "ordered" }])}, ${ts(addDays(now, -65))});`);

  // Newsletters, sent to everyone on the list at the time.
  const letters = [
    ["2025-10-02", "New: the autumn firing", "Fresh out of the kiln", "Our autumn firing is here: warm clay tones and a new ridged bowl."],
    ["2025-11-06", "Studio sale this weekend", "Studio sale", "Come by the studio on Saturday for seconds and samples at half price."],
    ["2025-11-24", "Black Week: 20 % off everything", "Black Week starts now", "Everything in the shop is 20 % off until Monday."],
    ["2025-12-04", "Christmas gift guide", "Gifts that last", "Handmade gifts for everyone on your list, and the last days to order for Christmas."],
    ["2025-12-15", "Last days for Christmas delivery", "Order by Thursday", "Order by Thursday for delivery before Christmas in Norway, Sweden and Denmark."],
    ["2026-01-21", "A look inside the studio", "New year, new glazes", "We spent January testing new glazes. Here is a peek at what is coming."],
    ["2026-02-26", "Spring is coming", "Bud vases are back", "Our bud vases are back in stock, just in time for the first flowers."],
    ["2026-03-25", "15 % off for spring", "Spring offer", "Use SPRING15 for 15 % off until 10 April."],
    ["2026-04-29", "Mother's Day gifts", "For Mother's Day", "A handmade piece for the person who taught you to care for things."],
    ["2026-05-27", "Summer table", "Set the summer table", "Serving dishes and pitchers for long summer evenings."],
    ["2026-06-17", "Summer offer: 15 % off", "Summer offer", "Use SUMMER15 for 15 % off all summer."],
    ["2026-08-19", "Back in the studio", "We are back", "Holidays are over and the kiln is warm again. New pieces next week."],
    ["2026-09-02", "20 % for our subscribers", "Just for you", "Use STUDIO20 for 20 % off until 14 September. Only for people on our list."],
    ["2026-10-07", "The autumn firing", "Autumn colours", "Deep greens and warm browns in our new autumn firing."],
    ["2026-11-05", "Christmas market dates", "Meet us this Christmas", "We are at the Christmas market in Oslo every weekend in December."],
  ];
  const subsAt = (d) => subs.filter((x) => x.at <= d).length;
  for (const [d, title, heading, text] of letters) {
    const id = uuid();
    const started = new Date(`${d}T07:${between(10, 50)}:00Z`);
    if (started > now) continue;
    const finished = addMinutes(started, between(2, 9));
    const recipients = subsAt(started);
    const bounced = Math.round(recipients * 0.006);
    const complained = chance(0.3) ? 1 : 0;
    const unsub = Math.round(recipients * 0.003);
    const skipped = Math.round(recipients * 0.01);
    const orders = built.filter((o) => o.at > started && o.at < addDays(started, 7) && o.fate !== "unpaid" && subOf.has(o.buyer.email) && chance(0.35));
    const credit = { orders: orders.length, minor: orders.reduce((m, o) => ({ ...m, [markets[o.market].currency]: (m[markets[o.market].currency] ?? 0) + o.total }), {}) };
    const counts = { recipients, queued: 0, sent: recipients - skipped, logged: 0, delivered: recipients - skipped - bounced, bounced, complained, failed: 0, skipped, unsubscribed: unsub, credit };
    const c = { "en-GB": { subject: title, preview: text.slice(0, 80), blocks: [{ type: "heading", text: heading }, { type: "paragraph", text }, { type: "product", product: products[i0(title, products.length)].id, handle: products[i0(title, products.length)].handle, label: products[i0(title, products.length)].title }, { type: "button", text: "Visit the shop", url: "/products" }] } };
    mk.push(`insert into commerce.broadcasts (id, store_id, title, audience, content, status, created_by, created_at, updated_at) values (${q(id)}, ${q(S)}, ${q(title)}, 'everyone', ${j(c)}, 'draft', ${q(owner)}, ${ts(addDays(started, -2))}, ${ts(addDays(started, -2))});
update commerce.broadcasts set status = 'sending', started_at = ${ts(started)}, recipient_count = ${recipients}, audience_words = 'Everyone on your list' where store_id = ${q(S)} and id = ${q(id)};
update commerce.broadcasts set status = 'sent', finished_at = ${ts(finished)}, counts = ${j(counts)}, updated_at = ${ts(finished)} where store_id = ${q(S)} and id = ${q(id)};
insert into commerce.broadcast_link_clicks (store_id, broadcast_id, link, clicks) values (${q(S)}, ${q(id)}, 'en-GB.2', ${Math.round(recipients * (0.02 + rand() * 0.03))}), (${q(S)}, ${q(id)}, 'en-GB.3', ${Math.round(recipients * (0.03 + rand() * 0.05))});`);
  }
  mk.push(`insert into commerce.broadcasts (store_id, title, audience, content, status, created_by, created_at, updated_at) values (${q(S)}, 'Christmas gift guide 2026', 'everyone',
  ${j({ "en-GB": { subject: "Christmas gift guide 2026", preview: "Handmade gifts that last.", blocks: [{ type: "heading", text: "Gifts that last" }, { type: "paragraph", text: "Our favourite pieces to give this Christmas, and the last days to order." }, { type: "button", text: "See the gift guide", url: "/products" }] } })}, 'draft', ${q(owner)}, ${ts(addDays(now, -1))}, ${ts(addDays(now, -1))});`);

  // Cart reminders on, with the three default steps; checkouts left in the last month, reminded and some recovered.
  const steps = [
    [60, { subject: "Forgot something at {store}?", heading: "Your cart is waiting", body: "You put a few things in your cart but did not finish checking out. We have kept them for you.", button: "Finish your purchase" }],
    [1440, { subject: "Your items at {store} are still waiting", heading: "Still interested?", body: "Your cart is saved. Stock can change, so finish your purchase while the items are available.", button: "Go to your cart" }],
    [4320, { subject: "Last reminder about your cart", heading: "Last reminder", body: "This is the last time we remind you about your cart at {store}.", button: "Finish your purchase" }],
  ];
  mk.push(`update commerce.stores set cart_reminders = true where id = ${q(S)};
insert into commerce.cart_reminder_steps (store_id, delay_minutes, active, content, created_at, updated_at) values
${steps.map(([m, t]) => `  (${q(S)}, ${m}, true, ${j({ "en-GB": t })}, ${ts(addDays(start, 40))}, ${ts(addDays(start, 40))})`).join(",\n")};`);
  for (const o of built.filter((x) => x.fate === "unpaid")) {
    const recent = o.at > addDays(now, -30);
    const lines = o.lines.map((l) => ({ variantId: l.p.variant, sellingPlanId: null, title: l.p.title, quantity: l.quantity, unitPriceMinor: l.unit }));
    const sent = recent ? Math.min(3, Math.floor((now - o.at) / (1440 * 60_000)) + 1) : 3;
    mk.push(`insert into commerce.abandoned_checkouts (store_id, cart_id, order_id, email, market_code, locale, currency, lines, subtotal_minor, token, captured_at, reminders_sent, last_delay_minutes, last_reminder_at, clicked_at, created_at, updated_at, abandoned_at)
values (${q(S)}, ${q(o.cart)}, ${q(o.id)}, ${recent ? q(o.buyer.email) : "null"}, ${q(o.market)}, ${q(markets[o.market].locale)}, ${q(markets[o.market].currency)}, ${recent ? j(lines) : "'[]'::jsonb"}, ${recent ? o.subtotal : 0}, ${q(token(32))}, ${ts(o.at)}, ${sent}, 4320, ${ts(addMinutes(o.at, [60, 1440, 4320][sent - 1]))}, ${chance(0.25) ? ts(addMinutes(o.at, 90)) : "null"}, ${ts(o.at)}, ${ts(o.at)}, ${ts(addMinutes(o.at, 30))})
on conflict (store_id, cart_id) do nothing;`);
  }

  // Ad spend each week, and searches from the last three months.
  const spend = [];
  for (let d = new Date(start); d < now; d = addDays(d, 7)) {
    const f = MONTH_FACTOR[d.getUTCMonth()];
    spend.push(`  (${q(S)}, ${q(day(d))}, 'paid_social', 'Always on: Instagram', ${Math.round((90000 + rand() * 60000) * f / 100) * 100}, ${ts(d)})`);
    spend.push(`  (${q(S)}, ${q(day(d))}, 'paid_search', 'Brand: Google', ${Math.round((25000 + rand() * 20000) * f / 100) * 100}, ${ts(d)})`);
  }
  mk.push(`insert into commerce.marketing_spend (store_id, day, channel, campaign, amount_minor, created_at) values\n${spend.join(",\n")};`);
  const terms = [["vase", 3], ["bowl", 2], ["cups", 1], ["moon jar", 1], ["pitcher", 1], ["candle", 1], ["serving dish", 1], ["gift card", 0], ["espresso cup", 0], ["white vase", 2], ["plate", 0], ["mug", 1], ["green", 2], ["christmas", 0]];
  const searchRows = [];
  const clickRows = [];
  for (let d = addDays(now, -85); d < now; d = addDays(d, 1)) {
    for (let k = 0; k < between(8, 22); k += 1) {
      const [t, results] = pick(terms);
      const id = uuid();
      const at = addMinutes(d, between(360, 1380));
      if (at > now) continue;
      searchRows.push(`  (${q(id)}, ${q(S)}, ${q(weighted([["NO", 60], ["SE", 25], ["DK", 15]]))}, ${q(t)}, ${results}, ${ts(at)})`);
      const match = products.filter((p) => t.split(" ").some((w) => p.handle.includes(w.replace(/s$/, "")) || p.title.toLowerCase().includes(w.replace(/s$/, ""))));
      if (results > 0 && match.length && chance(0.6)) clickRows.push(`  (${q(S)}, ${q(id)}, ${q(pick(match).id)}, ${between(1, Math.max(1, results))}, ${ts(addMinutes(at, 1))})`);
    }
  }
  mk.push(`insert into commerce.search_queries (id, store_id, market_code, query, results, created_at) values\n${searchRows.join(",\n")};`);
  if (clickRows.length) mk.push(`insert into commerce.search_clicks (store_id, search_id, product_id, position, created_at) values\n${clickRows.join(",\n")};`);
  file("80-marketing.sql", mk.join("\n"));
}

/** A stable pick from a list by a word. */
function i0(word, n) {
  let h = 0;
  for (const c of word) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % n;
}

function sourceOf(channel) {
  return { direct: null, organic_search: "google", organic_social: "instagram", paid_social: "instagram", email: "newsletter", referral: "pinterest", paid_search: "google" }[channel] ?? null;
}

/** Visits that bought nothing, per day: about 55 for each order of the day, smoothed so a day with no order still has visitors. */
function dailyVisits(built, start, end) {
  const perDay = new Map();
  for (const o of built) perDay.set(day(o.at), (perDay.get(day(o.at)) ?? 0) + 1);
  const days = [];
  for (let d = new Date(start); d < end; d = addDays(d, 1)) {
    const k = day(d);
    const f = dayFactor(d, start);
    days.push([k, Math.max(20, Math.round(f * 150 + (perDay.get(k) ?? 0) * 18))]);
  }
  return days;
}

// --- Command line -----------------------------------------------------------------------------------------------------------------------

async function apply(dir) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      const t = Date.now();
      await sql.unsafe(readFileSync(path.join(dir, name), "utf8"));
      console.log(`${name} ${Date.now() - t} ms`);
    }
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (args.includes("--context-sql")) {
    console.log(CONTEXT_SQL);
  } else if (arg("--apply")) {
    await apply(arg("--apply"));
  } else {
    const ctx = JSON.parse(readFileSync(arg("--context"), "utf8"));
    const end = new Date(arg("--end") ?? new Date().toISOString());
    const dir = arg("--out");
    const out = generate(ctx, end);
    mkdirSync(dir, { recursive: true });
    for (const f of out.files) writeFileSync(path.join(dir, f.name), f.sql);
    console.log(JSON.stringify(out.summary, null, 2));
    for (const f of out.files) console.log(`${f.name} ${(f.sql.length / 1024).toFixed(0)} KB`);
  }
}

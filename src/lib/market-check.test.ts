import { describe, expect, it } from "vitest";

import { marketCheckEn } from "./admin-messages/market-check.en";
import { marketCheckNb } from "./admin-messages/market-check.nb";
import { englishMoney } from "./money";
import {
  askAboutFinding,
  conversionOf,
  FINDING_KINDS,
  findingText,
  marketFindings,
  MIN_MISSES,
  MIN_ORDERS,
  MIN_VISITS,
  missRateOf,
  SWOT_OF,
  SWOT_PARTS,
  swotOf,
  type MarketCheckFacts,
  type MarketFacts,
} from "./market-check";
import type { RivalServiceFacts, RivalSiteFacts } from "./market-rivals";

const country = (code: string, over: Partial<MarketFacts> = {}): MarketFacts => ({
  code,
  name: code,
  sells: true,
  visits: null,
  visitOrders: null,
  orders: null,
  revenueMinor: null,
  searches: null,
  misses: null,
  missedTerms: [],
  unpriced: null,
  locale: null,
  untranslated: null,
  ...over,
});

const facts = (markets: MarketFacts[], over: Partial<MarketCheckFacts> = {}): MarketCheckFacts => ({
  markets,
  products: 100,
  demand: [],
  rivalOffers: [],
  rivalSites: [],
  published: 0,
  rivalServices: [],
  searchTerms: [],
  siteSpeeds: [],
  measure: "orders",
  ...over,
});
const names = new Map([
  ["NO", "Norway"],
  ["DE", "Germany"],
  ["SE", "Sweden"],
]);
const language = (l: string) => (l.startsWith("de") ? "German" : l);

describe("the market check's findings (D900 M1)", () => {
  it("finds a country that buys clearly less than the rest, with the orders it missed as an estimate", () => {
    const found = marketFindings(facts([country("NO", { visits: 2000, visitOrders: 60 }), country("DE", { visits: 1000, visitOrders: 5 })]));
    const weak = found.find((f) => f.kind === "weak_market");
    expect(weak).toMatchObject({ kind: "weak_market", market: "DE", visits: 1000, orders: 5, restVisits: 2000, restOrders: 60 });
    // At the rest's 3 % the 1,000 visits would have made 30 orders: 25 more than the 5 it had.
    expect(weak && weak.kind === "weak_market" ? weak.gap : null).toBe(25);
    // Norway is not called strong: its rest (Germany) has fewer than MIN_ORDERS orders to hold it against.
    expect(found.find((f) => f.kind === "strong_market")).toBeUndefined();
  });

  it("raises nothing on small numbers or a difference that may be chance", () => {
    // Too few visits in the country.
    expect(marketFindings(facts([country("NO", { visits: 5000, visitOrders: 150 }), country("DE", { visits: MIN_VISITS - 1, visitOrders: 0 })]))).toEqual([]);
    // Too few orders in the rest.
    expect(marketFindings(facts([country("NO", { visits: 5000, visitOrders: MIN_ORDERS - 1 }), country("DE", { visits: 5000, visitOrders: 0 })]))).toEqual([]);
    // Rates that differ a little: 3 % against 2.8 %.
    expect(marketFindings(facts([country("NO", { visits: 1000, visitOrders: 30 }), country("DE", { visits: 1000, visitOrders: 28 })]))).toEqual([]);
    // Visits not counted: no conversion to compare, never a zero.
    expect(marketFindings(facts([country("NO"), country("DE")]))).toEqual([]);
  });

  it("keeps a term that found nothing only from MIN_MISSES misses", () => {
    const demand = [
      { term: "linen", misses: MIN_MISSES, markets: [{ code: "DE", misses: MIN_MISSES }] },
      { term: "wool", misses: MIN_MISSES - 1, markets: [{ code: "NO", misses: MIN_MISSES - 1 }] },
    ];
    expect(marketFindings(facts([country("DE")], { demand })).map((f) => (f.kind === "unmet_demand" ? f.term : f.kind))).toEqual(["linen"]);
  });

  it("finds missing names in a country's language and missing prices only where the store sells", () => {
    const found = marketFindings(
      facts([
        country("DE", { locale: "de-DE", untranslated: 12, unpriced: 3 }),
        country("SE", { sells: false, unpriced: 7 }),
        country("NO", { locale: null, untranslated: null, unpriced: 0 }),
      ]),
    );
    expect(found).toEqual([
      { kind: "untranslated", market: "DE", locale: "de-DE", products: 12, of: 100 },
      { kind: "unpriced", market: "DE", products: 3, of: 100 },
    ]);
  });

  it("orders findings one of each kind first, each kind's largest first", () => {
    const found = marketFindings(
      facts(
        [
          country("NO", { visits: 4000, visitOrders: 200 }),
          country("DE", { visits: 1000, visitOrders: 5, locale: "de-DE", untranslated: 4, unpriced: 2 }),
          country("SE", { visits: 1000, visitOrders: 10, locale: "sv-SE", untranslated: 30 }),
        ],
        {
          demand: [
            { term: "wool", misses: 6, markets: [{ code: "NO", misses: 6 }] },
            { term: "linen", misses: 40, markets: [{ code: "DE", misses: 40 }] },
          ],
        },
      ),
    );
    const kinds = found.map((f) => f.kind);
    expect(kinds.slice(0, 5)).toEqual(["weak_market", "unmet_demand", "untranslated", "unpriced", "strong_market"]);
    // The largest of a kind first: Germany misses more orders than Sweden, "linen" more searches than "wool", Sweden more names.
    expect(found[0]).toMatchObject({ kind: "weak_market", market: "DE" });
    expect(found[1]).toMatchObject({ kind: "unmet_demand", term: "linen" });
    expect(found[2]).toMatchObject({ kind: "untranslated", market: "SE" });
    expect(found.slice(5).map((f) => f.kind)).toEqual(["weak_market", "unmet_demand", "untranslated"]);
  });

  it("finds a rival a tenth or more cheaper or dearer, or unable to sell, on an offer read within 30 days, and nothing else (D900 M2)", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    const offer = (over: Partial<MarketCheckFacts["rivalOffers"][number]>) => ({
      rivalName: "Linnet",
      market: "NO",
      productName: "Linen apron",
      priceMinor: 40000,
      currency: "NOK",
      own: { priceMinor: 46000, currency: "NOK" },
      availability: "in_stock",
      shippingMinor: null,
      shippingCurrency: null,
      returnDays: null,
      readAt: "2026-11-20T10:00:00Z",
      previous: null,
      changedAt: null,
      ...over,
    });
    const found = marketFindings(
      facts([country("NO")], {
        rivalOffers: [
          offer({}),
          offer({ productName: "Close call", own: { priceMinor: 43900, currency: "NOK" } }),
          offer({ productName: "Old", readAt: "2026-10-01T10:00:00Z" }),
          offer({ productName: "Other currency", currency: "EUR", priceMinor: 3000 }),
          offer({ productName: "Not held", own: null }),
          offer({ productName: "Cheaper here", own: { priceMinor: 35000, currency: "NOK" } }),
          offer({ productName: "Close the other way", own: { priceMinor: 36500, currency: "NOK" } }),
          // Out of stock at the rival: a gap it leaves, whatever the prices, and in any currency the store has a price in.
          offer({ productName: "Sold out there", availability: "out_of_stock", currency: "EUR", priceMinor: 3000 }),
          offer({ productName: "Gone and old", availability: "discontinued", readAt: "2026-10-01T10:00:00Z" }),
          offer({ productName: "Gone, not held", availability: "discontinued", own: null }),
        ],
      }),
      now,
    );
    expect(found).toEqual([
      { kind: "rival_cheaper", market: "NO", productName: "Linen apron", rivalName: "Linnet", ownMinor: 46000, rivalMinor: 40000, currency: "NOK", gap: 0.15 },
      { kind: "rival_out", market: "NO", productName: "Sold out there", rivalName: "Linnet", ownMinor: 46000, currency: "NOK" },
      { kind: "rival_dearer", market: "NO", productName: "Cheaper here", rivalName: "Linnet", ownMinor: 35000, rivalMinor: 40000, currency: "NOK", gap: 0.125 },
    ]);
    const [cheaper, out, dearer] = found;
    expect(findingText(cheaper, marketCheckEn.finding, names, language)).toBe(
      `Linnet sells Linen apron for ${englishMoney(40000, "NOK")} in Norway, and you ask ${englishMoney(46000, "NOK")}: 15 % more.`,
    );
    expect(findingText(dearer, marketCheckEn.finding, names, language)).toBe(
      `You sell Cheaper here for ${englishMoney(35000, "NOK")} in Norway, and Linnet asks ${englishMoney(40000, "NOK")}: you are 13 % cheaper.`,
    );
    expect(findingText(out, marketCheckEn.finding, names, language)).toBe(
      `Linnet's own page says its match for your Sold out there cannot be bought now in Norway, where you sell yours for ${englishMoney(46000, "NOK")}. It may be worth telling shoppers there.`,
    );
  });

  it("finds a rival's move since its page was read before, a threat whatever the prices stand at now (D900 M3)", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    const was = { priceMinor: 52000, currency: "NOK", availability: "in_stock", shippingMinor: 9900, shippingCurrency: "NOK", returnDays: 14, readAt: "2026-10-28T10:00:00Z" };
    const moved = (over: Partial<MarketCheckFacts["rivalOffers"][number]>) => ({
      rivalName: "Linnet",
      market: "NO",
      productName: "Linen apron",
      priceMinor: 52000,
      currency: "NOK",
      own: { priceMinor: 46000, currency: "NOK" },
      availability: "in_stock",
      shippingMinor: 9900,
      shippingCurrency: "NOK",
      returnDays: 14,
      readAt: "2026-11-24T10:00:00Z",
      previous: was,
      changedAt: "2026-11-24T10:00:00Z",
      ...over,
    });
    const found = marketFindings(
      facts([country("NO")], {
        rivalOffers: [
          // Cut from 520 to 480: still dearer than the store, but a move against it.
          moved({ priceMinor: 48000 }),
          moved({ productName: "Wool throw", shippingMinor: 0 }),
          moved({ productName: "Mug", returnDays: 30 }),
          moved({ productName: "Old move", changedAt: "2026-10-01T10:00:00Z" }),
        ],
      }),
      now,
    );
    const moves = found.filter((f) => f.kind === "rival_move");
    expect(moves.map((f) => (f.kind === "rival_move" ? [f.productName, f.move] : null))).toEqual([
      ["Linen apron", "price"],
      ["Wool throw", "shipping"],
      ["Mug", "returns"],
    ]);
    expect(swotOf(found).threats).toHaveLength(3);
    const [price, shipping, returns] = moves;
    expect(findingText(price, marketCheckEn.finding, names, language)).toBe(
      `Linnet cut its price for its match to your Linen apron in Norway, from ${englishMoney(52000, "NOK")} to ${englishMoney(48000, "NOK")}, since its page was read before.`,
    );
    expect(findingText(shipping, marketCheckEn.finding, names, language)).toBe(
      `Linnet cut its shipping on its match to your Wool throw in Norway, from ${englishMoney(9900, "NOK")} to ${englishMoney(0, "NOK")}.`,
    );
    expect(findingText(returns, marketCheckEn.finding, names, language)).toBe("Linnet now gives 30 days to return its match to your Mug in Norway, up from 14.");
  });

  it("finds a rival's site that added pages faster than the store published, from a complete listing only (D905)", () => {
    const site = (rivalName: string, over: Partial<RivalSiteFacts> = {}): RivalSiteFacts => ({
      rivalId: rivalName,
      rivalName,
      market: "NO",
      host: `${rivalName.toLowerCase()}.example`,
      readAt: "2026-11-24T10:00:00Z",
      since: "2026-10-01T10:00:00Z",
      pages: 120,
      cut: false,
      problem: null,
      added: 12,
      gone: 1,
      section: "/blog",
      newest: ["/blog/a"],
      ...over,
    });
    const found = marketFindings(
      facts([country("NO", { sells: false })], {
        published: 2,
        rivalSites: [
          site("Rapid"),
          site("Fewer", { added: 4 }),
          // A listing past the cap may show pages as added that were only beyond it before.
          site("Huge", { cut: true, added: 40 }),
          // Only the first listing: nothing is added yet.
          site("New", { since: null, added: 0 }),
          site("Even", { added: 5, section: null }),
        ],
      }),
    );
    const sites = found.filter((f) => f.kind === "rival_site");
    expect(sites.map((f) => (f.kind === "rival_site" ? [f.rivalName, f.added] : null))).toEqual([
      ["Rapid", 12],
      ["Even", 5],
    ]);
    expect(swotOf(found).threats).toHaveLength(2);
    // Twice what the store published is not more than twice.
    expect(marketFindings(facts([country("NO")], { published: 6, rivalSites: [site("Rapid")] })).filter((f) => f.kind === "rival_site")).toEqual([]);
    expect(findingText(sites[0], marketCheckEn.finding, names, language)).toBe("Rapid added 12 pages to its site in 30 days, most under /blog; you published 2.");
    expect(findingText(sites[1], marketCheckNb.finding, names, language)).toBe("Even la til 5 sider på nettstedet sitt på 30 dager; du publiserte 2.");
  });

  it("holds a rival's service price found on its page against the store's own, a tenth apart either way (D905 M5d)", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    const service = (name: string, over: Partial<RivalServiceFacts> = {}): RivalServiceFacts => ({
      rivalName: "Klipp",
      market: "NO",
      service: name,
      priceMinor: 50000,
      currency: "NOK",
      per: "hour",
      own: { priceMinor: 60000, currency: "NOK" },
      checkedOn: "2026-11-24",
      onPage: true,
      goneAt: null,
      ...over,
    });
    const found = marketFindings(
      facts([country("NO", { sells: false })], {
        rivalServices: [
          service("Haircut"),
          service("Colour", { priceMinor: 80000 }),
          // Within a tenth, not found on its page, or with no price of the store's: shown, never found.
          service("Wash", { priceMinor: 57000 }),
          service("Beard", { onPage: false }),
          service("Styling", { own: null }),
        ],
      }),
      now,
    );
    expect(found.map((f) => (f.kind === "service_cheaper" || f.kind === "service_dearer" ? [f.kind, f.service] : f.kind))).toEqual([
      ["service_cheaper", "Haircut"],
      ["service_dearer", "Colour"],
    ]);
    const swot = swotOf(found);
    expect([swot.weaknesses.length, swot.strengths.length]).toEqual([1, 1]);
    const [cheaper, dearer] = found;
    expect(findingText(cheaper, marketCheckEn.finding, names, language)).toBe(
      `Klipp asks ${englishMoney(50000, "NOK")} an hour for Haircut in Norway, and you ask ${englishMoney(60000, "NOK")} an hour: 20 % more.`,
    );
    expect(findingText(dearer, marketCheckNb.finding, names, language)).toBe(
      `Du tar ${englishMoney(60000, "NOK")} i timen for Colour i Norway, og Klipp tar ${englishMoney(80000, "NOK")} i timen: du er 25 % billigere.`,
    );
  });

  it("finds where the store came up for a word it follows: behind a rival, or near the top with none above (D905 M5b)", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    const term = (word: string, own: number | null, rival: number | null) => ({
      term: word,
      market: "NO",
      checkedAt: "2026-11-24T10:00:00Z",
      own,
      rivals: [{ name: "Linnet", host: "linnet.no", position: rival }],
    });
    const found = marketFindings(facts([country("NO", { sells: false })], { searchTerms: [term("linen apron", 7, 2), term("linforkle", null, 4), term("forkle", 1, 5), term("lin", 5, null)] }), now);
    const words = found.map((f) => (f.kind === "search_behind" || f.kind === "search_ahead" ? [f.kind, f.term] : f.kind));
    expect(words).toEqual([
      ["search_behind", "linforkle"],
      ["search_ahead", "forkle"],
      ["search_behind", "linen apron"],
    ]);
    expect(swotOf(found).weaknesses).toHaveLength(2);
    const behind = found.find((f) => f.kind === "search_behind" && f.term === "linen apron")!;
    const missing = found.find((f) => f.kind === "search_behind" && f.term === "linforkle")!;
    const ahead = found.find((f) => f.kind === "search_ahead")!;
    expect(findingText(behind, marketCheckEn.finding, names, language)).toBe("Linnet is number 2 in a search for “linen apron” in Norway; you are number 7.");
    expect(findingText(missing, marketCheckEn.finding, names, language)).toBe("Linnet is number 4 in a search for “linforkle” in Norway; you are not on the first page.");
    expect(findingText(ahead, marketCheckNb.finding, names, language)).toBe("Du er nummer 1 i et søk etter «forkle» i Norway, og ingen konkurrent du følger, er over deg.");
  });

  it("says a country asks less or more where conversion counts enquiries, with the same minimums (D905 M5e)", () => {
    const markets = [country("NO", { visits: 2000, visitOrders: 60, sells: false }), country("DE", { visits: 1000, visitOrders: 5, sells: false })];
    const [weak] = marketFindings(facts(markets, { measure: "enquiries" }));
    expect(weak).toMatchObject({ kind: "weak_market", measure: "enquiries", market: "DE", gap: 25 });
    expect(findingText(weak, marketCheckEn.finding, names, language)).toBe(
      "Visitors in Germany ask less: 0.5 % of visits end in an enquiry, against 3.0 % in your other countries. At that rate it would have had about 25 more enquiries.",
    );
    expect(findingText(weak, marketCheckNb.finding, names, language)).toContain("spør mindre");
  });

  it("finds a rival's site good where the store's is poor, by Chrome's measure (D905 M5c)", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    const speed = (rivalName: string | null, lcp: number, inp: number, cls: number) => ({
      host: `${rivalName ?? "own"}.no`,
      rivalName,
      lcp,
      inp,
      cls,
      checkedAt: "2026-11-24T10:00:00Z",
      periodEnd: "2026-11-22",
      problem: null,
    });
    const found = marketFindings(facts([country("NO", { sells: false })], { siteSpeeds: [speed(null, 4800, 600, 300), speed("Linnet", 1900, 150, 20)] }), now);
    const speedFindings = found.filter((f) => f.kind === "speed_behind");
    // The largest gap first: layout shift 15 times the rival's, a tap four times, the main content 2.5 times.
    expect(speedFindings.map((f) => (f.kind === "speed_behind" ? f.metric : null))).toEqual(["cls", "inp", "lcp"]);
    expect(swotOf(found).weaknesses).toHaveLength(3);
    const lcp = speedFindings.find((f) => f.kind === "speed_behind" && f.metric === "lcp")!;
    const cls = speedFindings.find((f) => f.kind === "speed_behind" && f.metric === "cls")!;
    expect(findingText(lcp, marketCheckEn.finding, names, language)).toBe(
      "Linnet's pages show their main content in 1.9 s for most visitors; yours take 4.8 s, which Google counts as slow.",
    );
    expect(findingText(cls, marketCheckNb.finding, names, language, undefined, "nb-NO")).toBe(
      "Sidene til Linnet flytter seg knapt mens de lastes (0,02); dine flytter seg 0,30, som Google regner som dårlig.",
    );
  });

  it("draws the findings as a SWOT, each in the part its kind is, in their own order; a rival's move is a threat (D900 M2, M3)", () => {
    expect(new Set(Object.values(SWOT_OF))).toEqual(new Set(SWOT_PARTS));
    expect(Object.entries(SWOT_OF).filter(([, part]) => part === "threats").map(([kind]) => kind)).toEqual(["rival_move", "rival_site"]);
    expect(Object.keys(SWOT_OF).sort()).toEqual([...FINDING_KINDS].sort());
    const found = marketFindings(
      facts(
        [
          country("NO", { visits: 3000, visitOrders: 150 }),
          country("SE", { visits: 1000, visitOrders: 35 }),
          country("DE", { visits: 1000, visitOrders: 5, locale: "de-DE", untranslated: 4 }),
        ],
        {
          demand: [{ term: "linen", misses: 9, markets: [{ code: "DE", misses: 9 }] }],
        },
      ),
    );
    const swot = swotOf(found);
    expect(SWOT_PARTS.map((p) => swot[p].map((f) => f.kind))).toEqual([["strong_market"], ["weak_market", "untranslated"], ["unmet_demand"], []]);
  });

  it("works out rates only from what is known", () => {
    expect(conversionOf({ visits: 200, visitOrders: 4 })).toBe(0.02);
    expect(conversionOf({ visits: null, visitOrders: null })).toBeNull();
    expect(conversionOf({ visits: 0, visitOrders: 0 })).toBeNull();
    expect(missRateOf({ searches: 50, misses: 5 })).toBe(0.1);
    expect(missRateOf({ searches: null, misses: null })).toBeNull();
  });
});

describe("the market check's words (D900 M1)", () => {
  const w = marketCheckEn.finding;

  it("writes each finding with its figures from code", () => {
    const [weak] = marketFindings(facts([country("NO", { visits: 2000, visitOrders: 60 }), country("DE", { visits: 1000, visitOrders: 5 })]));
    expect(findingText(weak, w, names, language)).toBe(
      "Visitors in Germany buy less: 0.5 % of visits end in an order, against 3.0 % in your other countries. At that rate it would have had about 25 more orders.",
    );
    expect(findingText({ kind: "unmet_demand", term: "linen", misses: 41, markets: [{ code: "SE", misses: 2 }, { code: "DE", misses: 39 }] }, w, names, language)).toBe(
      "Shoppers searched for “linen” 41 times and found nothing, most of them in Germany.",
    );
    expect(findingText({ kind: "untranslated", market: "DE", locale: "de-DE", products: 12, of: 100 }, w, names, language)).toBe(
      "12 of your 100 products have no name in German, so shoppers in Germany read them in another language.",
    );
    expect(findingText({ kind: "unpriced", market: "XX", products: 3, of: 100 }, w, names, language)).toBe("3 of your 100 products have no price in XX, so they cannot be bought there.");
  });

  it("cuts a long term and hands the AI manager the finding with a plan kept for a yes", () => {
    const text = findingText({ kind: "unmet_demand", term: "x".repeat(80), misses: 5, markets: [] }, w, names, language);
    expect(text).toContain(`“${"x".repeat(59)}…”`);
    const message = askAboutFinding("Shoppers searched for “linen” 41 times and found nothing.", "last 30 days", marketCheckEn.ask);
    expect(message).toBe(
      "Analytics → Markets found this for last 30 days: Shoppers searched for “linen” 41 times and found nothing. Look into it with your tools and make a plan I can say yes to. Change nothing before I do.",
    );
  });
});

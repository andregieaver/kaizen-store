import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { assembleLegalFacts, formatReturnAddress, missingFacts, type LegalFacts, type LegalFactsInput } from "./legal-facts";
import {
  CONDITIONAL_TOPICS,
  LEGAL_REVIEW_MANIFEST,
  REQUIRED_TOPICS,
  STARTER_LANGUAGES,
  STARTER_ROLES,
  STARTER_TEXTS,
  fill,
  legalStarter,
  legalStarterSections,
  reviewNotice,
  starterKeys,
  starterLanguageOf,
  starterRoleOf,
  starterSlug,
  starterTitle,
  type StarterLanguage,
  type StarterRole,
} from "./legal-starters";
import { LEGAL_NOTICE_CLASS, blockingIssues, pageIssues } from "./page-a11y";
import { newPageContent, parsePageContent, type PageBlock, type PageRow, type RichTextDoc } from "./page-content";
import { DEFAULT_RETURN_SETTINGS } from "./withdrawal";

const counter = () => {
  let n = 0;
  return () => `b${++n}`;
};

const input = (over: Partial<LegalFactsInput> = {}): LegalFactsInput => ({
  store: {
    name: "Demo Butikk",
    legalName: "Demo Butikk AS",
    organisationNumber: "999 888 777",
    contactEmail: "kontakt@demo.example",
    postalAddress: "Storgata 1, 0155 Oslo",
    country: "NO",
    audience: "both",
    visitCounting: true,
    modules: ["bookings", "deliveries"],
    tracking: { ga4: "G-ABCDEFGH", metaPixel: "1234567" },
  },
  tax: { vatNumber: "NO999888777MVA", registered: true },
  markets: [
    { code: "NO", currency: "NOK" },
    { code: "SE", currency: "SEK" },
    { code: "DE", currency: "EUR" },
  ],
  shippingRates: [
    { marketCode: "NO", currency: "NOK", rateMinor: 5900, freeAboveMinor: 99900 },
    { marketCode: "SE", currency: "SEK", rateMinor: 0, freeAboveMinor: null },
    { marketCode: "DE", currency: "EUR", rateMinor: 990, freeAboveMinor: null },
  ],
  carrierNames: ["Posten", "PostNord"],
  returnSettings: { ...DEFAULT_RETURN_SETTINGS, windowDays: 30, whoPaysReturn: "shopper", refundWhen: "received", acceptExcluded: true, instructions: "Pakk varene i originalemballasjen.", b2bReturns: true },
  chatOn: true,
  links: { withdraw: "/s/demo/no/withdraw", cookies: "/s/demo/no/cookies" },
  phone: "+47 22 00 00 00",
  ...over,
});

const FULL = assembleLegalFacts(input());

/** Facts that between them take every branch the shapes have. */
const VARIANTS: Record<string, LegalFacts> = {
  full: FULL,
  empty: assembleLegalFacts(
    input({
      store: { name: "", legalName: null, organisationNumber: null, contactEmail: null, postalAddress: null, country: null, audience: "consumers", visitCounting: false, modules: [], tracking: {} },
      tax: null,
      markets: [],
      shippingRates: [],
      carrierNames: [],
      returnSettings: null,
      chatOn: false,
      links: {},
      phone: null,
    }),
  ),
  consumersStoreShopper: assembleLegalFacts(
    input({
      store: { ...input().store, audience: "consumers", modules: ["bookings"], visitCounting: false, tracking: {} },
      tax: { vatNumber: null, registered: false },
      returnSettings: { ...DEFAULT_RETURN_SETTINGS, whoPaysReturn: "store", refundWhen: "request", acceptExcluded: false, instructions: "" },
      chatOn: false,
      links: {},
    }),
  ),
  businessesOnly: assembleLegalFacts(
    input({
      store: { ...input().store, audience: "businesses", modules: ["deliveries"] },
      tax: { vatNumber: "SE123", registered: null },
      returnSettings: { ...DEFAULT_RETURN_SETTINGS, b2bReturns: false },
      shippingRates: [{ marketCode: "NO", currency: "NOK", rateMinor: 4900, freeAboveMinor: null }],
    }),
  ),
};

const META = /^(notice|notice\.language|ph\.|label\.|title\.|slug\.)/;

describe("the starters' tables", () => {
  it("have the same keys in all four languages", () => {
    const reference = Object.keys(STARTER_TEXTS.en.m).sort();
    for (const language of STARTER_LANGUAGES) {
      const keys = Object.keys(STARTER_TEXTS[language].m).sort();
      expect({ language, missing: reference.filter((k) => !keys.includes(k)), extra: keys.filter((k) => !reference.includes(k)) }).toEqual({ language, missing: [], extra: [] });
    }
  });

  it("hold every key the shapes use, and every key is used by some shape or is a title, label or notice", () => {
    const used = new Set<string>();
    for (const facts of Object.values(VARIANTS)) for (const role of STARTER_ROLES) for (const key of starterKeys(role, facts)) used.add(key);
    for (const language of STARTER_LANGUAGES) {
      const keys = Object.keys(STARTER_TEXTS[language].m);
      expect({ language, missing: [...used].filter((k) => !keys.includes(k)) }).toEqual({ language, missing: [] });
      expect({ language, orphans: keys.filter((k) => !META.test(k) && !used.has(k)) }).toEqual({ language, orphans: [] });
    }
  });

  it("use the same {holes} in every language for the same sentence", () => {
    const holes = (text: string) => [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(STARTER_TEXTS.en.m)) {
      const english = holes(STARTER_TEXTS.en.m[key]);
      for (const language of ["nb", "sv", "da"] as const) expect([language, key, holes(STARTER_TEXTS[language].m[key])]).toEqual([language, key, english]);
    }
  });

  it("are written in their own language, not left in English", () => {
    for (const language of ["nb", "sv", "da"] as const) {
      const same = Object.entries(STARTER_TEXTS[language].m).filter(([key, text]) => text.length > 30 && text === STARTER_TEXTS.en.m[key]);
      expect({ language, same: same.map(([k]) => k) }).toEqual({ language, same: [] });
    }
  });

  it("name each page in its own language, with an address of plain letters", () => {
    for (const language of STARTER_LANGUAGES) {
      for (const role of STARTER_ROLES) {
        expect(starterTitle(role, language).length).toBeGreaterThan(3);
        expect(starterSlug(role, language)).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    }
    expect(starterTitle("terms", "nb")).toBe("Kjøpsvilkår");
    expect(starterTitle("terms", "sv")).toBe("Köpvillkor");
    expect(starterTitle("terms", "da")).toBe("Handelsbetingelser");
    expect(starterTitle("terms", "en")).toBe("Terms of sale");
  });
});

describe("what a starter holds", () => {
  const cases = STARTER_ROLES.flatMap((role) => STARTER_LANGUAGES.flatMap((language) => Object.entries(VARIANTS).map(([name, facts]) => ({ role, language, name, facts }))));

  it.each(STARTER_ROLES)("%s has the same sections and blocks in every language, for every kind of store", (role) => {
    for (const [name, facts] of Object.entries(VARIANTS)) {
      const shapes = STARTER_LANGUAGES.map((language) => legalStarterSections(role, language, facts).map((s) => [s.topic, s.blocks.map((b) => ("p" in b ? "p" : `ul${b.ul.length}`))]));
      for (const shape of shapes) expect([name, shape]).toEqual([name, shapes[0]]);
    }
  });

  it.each(cases.filter((c) => c.name === "full" || c.name === "businessesOnly"))("$role in $language ($name) carries every required topic", ({ role, language, facts }) => {
    const topics = legalStarterSections(role, language, facts).map((s) => s.topic);
    for (const topic of REQUIRED_TOPICS[role]) expect(topics).toContain(topic);
    for (const [topic, applies] of Object.entries(CONDITIONAL_TOPICS[role])) expect([topic, topics.includes(topic)]).toEqual([topic, applies(facts)]);
    // Nothing but what is required or conditional.
    const allowed = new Set([...REQUIRED_TOPICS[role], ...Object.keys(CONDITIONAL_TOPICS[role])]);
    expect(topics.filter((t) => !allowed.has(t))).toEqual([]);
  });

  it("has no hole left unfilled and no unbalanced placeholder, in any language, for any kind of store", () => {
    for (const { role, language, name, facts } of cases) {
      const text = JSON.stringify(legalStarterSections(role, language, facts));
      expect([role, language, name, /\{[A-Za-z0-9_]+\}/.test(text)]).toEqual([role, language, name, false]);
      const opens = (text.match(/\[\[/g) ?? []).length;
      const closes = (text.match(/\]\]/g) ?? []).length;
      expect([role, language, name, opens === closes]).toEqual([role, language, name, true]);
    }
  });

  it("never links the EU's online dispute resolution platform, which no longer exists", () => {
    for (const { role, language, facts } of cases.filter((c) => c.name === "full")) {
      const text = JSON.stringify(legalStarterSections(role, language, facts));
      expect(text).not.toMatch(/ec\.europa\.eu\/consumers\/odr|\bODR\b|online dispute resolution|online tvisteløsning|nettbasert tvisteløsning|tvistlösning online|onlinetvistløsning|onlinemekling/i);
    }
  });

  it("states the store's own facts, in the language's own number format", () => {
    const text = (role: StarterRole, language: StarterLanguage) => JSON.stringify(legalStarterSections(role, language, FULL));
    for (const language of STARTER_LANGUAGES) {
      const terms = text("terms", language);
      for (const fact of ["Demo Butikk AS", "999 888 777", "Storgata 1, 0155 Oslo", "kontakt@demo.example", "+47 22 00 00 00", "Demo Butikk"]) expect([language, fact, terms.includes(fact)]).toEqual([language, fact, true]);
      expect(text("imprint", language)).toContain("NO999888777MVA");
      expect(text("returns_policy", language)).toContain("30");
      expect(text("returns_policy", language)).toContain("Storgata 1");
    }
    // 59 kroner and the free-above amount, each as the language writes money.
    const shipping = (language: StarterLanguage) => legalStarterSections("shipping_policy", language, FULL).find((s) => s.topic === "rates")!.blocks.find((b) => "ul" in b) as { ul: string[] };
    expect(shipping("nb").ul[0]).toMatch(/Norge: .*59,00.*999,00/);
    expect(shipping("sv").ul[0]).toMatch(/Norge: .*59,00/);
    expect(shipping("da").ul[0]).toMatch(/Norge: .*59,00/);
    expect(shipping("en").ul[0]).toMatch(/Norway: .*59\.00.*999\.00/);
    expect(shipping("en").ul[1]).toBe("Sweden: free.");
    expect(shipping("nb").ul[1]).toBe("Sverige: gratis.");
    expect(shipping("en").ul[2]).toMatch(/Germany: .*9\.90/);
  });

  it("says the store's carriers, its tools and the AI assistant only when it has them", () => {
    const privacy = (facts: LegalFacts) => JSON.stringify(legalStarterSections("privacy", "en", facts));
    expect(privacy(FULL)).toContain("Posten and PostNord");
    expect(privacy(FULL)).toContain("Google Analytics 4");
    expect(privacy(FULL)).toContain("Meta Pixel");
    expect(privacy(FULL)).toMatch(/chat assistant/);
    expect(privacy(FULL)).toMatch(/without cookies/);
    const bare = privacy(VARIANTS.consumersStoreShopper);
    expect(bare).not.toMatch(/chat assistant|Google Analytics|without cookies/);
  });

  it("follows the store's return settings", () => {
    const returns = (facts: LegalFacts) => JSON.stringify(legalStarterSections("returns_policy", "en", facts));
    expect(returns(FULL)).toContain("30 days");
    expect(returns(FULL)).toContain("our own longer return window");
    expect(returns(FULL)).toContain("You pay the direct cost");
    expect(returns(FULL)).toContain("Pakk varene i originalemballasjen.");
    expect(returns(FULL)).toContain("We still take back some of these goods");
    expect(returns(VARIANTS.consumersStoreShopper)).not.toContain("our own longer return window");
    expect(returns(VARIANTS.consumersStoreShopper)).toContain("We pay the cost of sending the goods back");
    expect(returns(VARIANTS.consumersStoreShopper)).toContain("We do not take back these goods");
    expect(returns(VARIANTS.consumersStoreShopper)).not.toContain("Businesses can return");
    // The legal 14 days are never promised as less.
    expect(assembleLegalFacts(input({ returnSettings: { ...DEFAULT_RETURN_SETTINGS, windowDays: 3 } })).returns.windowDays).toBe(14);
  });

  it("makes a visible placeholder of every fact the store lacks, in the language's own words", () => {
    const empty = VARIANTS.empty;
    const prefixes = { nb: ["Legg til", "Kontroller"], sv: ["Lägg till", "Kontrollera"], da: ["Tilføj", "Kontrollér"], en: ["Add", "Check"] } as const;
    for (const language of STARTER_LANGUAGES) {
      const [add, check] = prefixes[language];
      for (const role of STARTER_ROLES) {
        const text = JSON.stringify(legalStarterSections(role, language, empty));
        expect([language, role, text.includes(`[[${add}: `)]).toEqual([language, role, true]);
        if (role !== "shipping_policy" || language) expect([language, role, text.includes(`[[${check}: `) || text.includes(`[[${add}: `)]).toEqual([language, role, true]);
      }
      const terms = JSON.stringify(legalStarterSections("terms", language, empty));
      expect(terms).toContain(`[[${add}: ${STARTER_TEXTS[language].m["label.legalName"]}]]`);
      expect(terms).toContain(`[[${add}: ${STARTER_TEXTS[language].m["label.phone"]}]]`);
      expect(terms).toContain(`[[${check}: ${STARTER_TEXTS[language].m["label.complaintBody"]}]]`);
    }
    // The VAT number is only asked for when the store is not known to be unregistered.
    expect(JSON.stringify(legalStarterSections("imprint", "en", empty))).toContain("[[Add: VAT number]]");
    expect(JSON.stringify(legalStarterSections("imprint", "en", VARIANTS.consumersStoreShopper))).toContain("not registered for VAT");
    expect(JSON.stringify(legalStarterSections("imprint", "en", VARIANTS.consumersStoreShopper))).not.toContain("VAT number");
  });

  it("keeps square brackets in a store's own text from making a link or a placeholder", () => {
    const facts = assembleLegalFacts(input({ store: { ...input().store, legalName: "Evil [click](https://evil.example) [[Add: x]] AS" } }));
    const page = legalStarter("imprint", "en", facts, counter());
    const text = JSON.stringify(page.rows);
    // The brackets became parentheses: no link was made, and the placeholder is not one.
    expect(text).not.toContain('"type":"link"');
    expect(text).toContain("Evil (click)(https://evil.example) ((Add: x)) AS");
  });
});

describe("the page it makes", () => {
  const build = (role: StarterRole, language: StarterLanguage, facts = FULL) => legalStarter(role, language, facts, counter());
  const blocks = (rows: PageRow[]) => rows.flatMap((r) => r.columns.flatMap((c) => c.blocks));
  const plain = (doc: RichTextDoc) => JSON.stringify(doc);

  it("opens with the draft notice in a row of its own, in every language", () => {
    const notices = { nb: "UTKAST", sv: "UTKAST", da: "UDKAST", en: "DRAFT" } as const;
    for (const language of STARTER_LANGUAGES) {
      for (const role of STARTER_ROLES) {
        const page = build(role, language);
        const first = page.rows[0].columns[0].blocks;
        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({ type: "richText", className: LEGAL_NOTICE_CLASS });
        expect(plain((first[0] as Extract<PageBlock, { type: "richText" }>).doc)).toContain(notices[language]);
        expect(page.rows).toHaveLength(2);
      }
    }
  });

  it("says when the language is not the store's own", () => {
    expect(reviewNotice("en", { translated: true })).toMatch(/not available in your store's language/);
    expect(reviewNotice("en")).not.toMatch(/not available/);
    const page = legalStarter("terms", "en", FULL, counter(), { translatedNotice: true });
    expect(plain((page.rows[0].columns[0].blocks[0] as Extract<PageBlock, { type: "richText" }>).doc)).toMatch(/translated and reviewed/);
  });

  it("has one main heading, a heading for each section with an address of its own, and the text under it", () => {
    const page = build("terms", "nb");
    const all = blocks(page.rows);
    const headings = all.filter((b): b is Extract<PageBlock, { type: "heading" }> => b.type === "heading");
    expect(headings[0]).toMatchObject({ level: 1, text: "Kjøpsvilkår" });
    expect(headings.slice(1).every((h) => h.level === 2)).toBe(true);
    const ids = headings.map((h) => h.htmlId).filter(Boolean) as string[];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("t-withdrawal");
    for (const id of ids) expect(id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
    expect(all.filter((b) => b.type === "richText").length).toBe(headings.length); // the notice plus one text per section
  });

  it("makes the same blocks, with the same ids, in every language, so translations line up", () => {
    const shape = (language: StarterLanguage) => blocks(build("privacy", language).rows).map((b) => `${b.id}:${b.type}`);
    for (const language of STARTER_LANGUAGES) expect(shape(language)).toEqual(shape("en"));
  });

  it("makes lists of lines and links to the site where the address is one", () => {
    const page = build("terms", "en");
    const text = plain({ type: "doc", content: blocks(page.rows).flatMap((b) => (b.type === "richText" ? b.doc.content : [])) });
    expect(text).toContain('"type":"bulletList"');
    expect(text).toContain('"href":"/s/demo/no/withdraw"');
    // Without an address for the page there is no link, and the sentence still reads.
    const none = assembleLegalFacts(input({ links: {} }));
    const without = JSON.stringify(build("terms", "en", none).rows);
    expect(without).not.toContain('"link"');
    expect(without).toContain("Read the withdrawal information on this site");
  });

  it("is a page the site accepts: it parses as page content, in every language and kind", () => {
    for (const language of STARTER_LANGUAGES) {
      for (const role of STARTER_ROLES) {
        const page = build(role, language);
        const parsed = parsePageContent({ ...newPageContent(), title: page.title, slug: page.slug, rows: page.rows });
        expect([language, role, parsed !== null]).toEqual([language, role, true]);
      }
    }
  });

  it("is blocked by the checker for its notice and its placeholders, and by nothing else once they are dealt with", () => {
    const page = build("terms", "en", VARIANTS.empty);
    const issues = pageIssues({ title: page.title, rows: page.rows });
    expect(new Set(blockingIssues(issues).map((i) => i.rule))).toEqual(new Set(["legal_notice", "placeholder"]));
    // A store with every fact, the notice taken away: placeholders for the lawyer's questions remain, nothing else is wrong.
    const finished = build("terms", "en");
    const noNotice = finished.rows.slice(1);
    const left = pageIssues({ title: finished.title, rows: noNotice });
    expect(new Set(left.map((i) => i.rule))).toEqual(new Set(["placeholder"]));
    for (const role of STARTER_ROLES) {
      for (const language of STARTER_LANGUAGES) {
        const p = build(role, language);
        const other = pageIssues({ title: p.title, rows: p.rows.slice(1) }).filter((i) => i.rule !== "placeholder");
        expect([role, language, other.map((i) => i.rule)]).toEqual([role, language, []]);
      }
    }
  });
});

describe("stores that sell services and subscription boxes (CRD Art. 6(1)(h), 9(2), 14(3), 16(a), (l))", () => {
  const goodsOnly = assembleLegalFacts(input({ store: { ...input().store, modules: [] } }));
  const bookingsOnly = assembleLegalFacts(input({ store: { ...input().store, modules: ["bookings"] } }));
  const boxesOnly = assembleLegalFacts(input({ store: { ...input().store, modules: ["deliveries"] } }));
  const textOf = (role: StarterRole, language: StarterLanguage, facts: LegalFacts) => JSON.stringify(legalStarterSections(role, language, facts));
  const m = (language: StarterLanguage, key: string) => STARTER_TEXTS[language].m[key];

  it.each(STARTER_LANGUAGES)("says in %s when the period runs from the contract (services) and from the first delivery (boxes), only where those are sold", (language) => {
    const services = m(language, "withdrawal.right.services");
    const regular = m(language, "withdrawal.right.regular");
    expect(textOf("withdrawal_info", language, bookingsOnly)).toContain(JSON.stringify(services).slice(1, -1));
    expect(textOf("withdrawal_info", language, bookingsOnly)).not.toContain(JSON.stringify(regular).slice(1, -1));
    expect(textOf("withdrawal_info", language, boxesOnly)).toContain(JSON.stringify(regular).slice(1, -1));
    expect(textOf("withdrawal_info", language, boxesOnly)).not.toContain(JSON.stringify(services).slice(1, -1));
    for (const key of ["withdrawal.right.services", "withdrawal.right.regular", "withdrawal.effects.services"]) expect(textOf("withdrawal_info", language, goodsOnly)).not.toContain(JSON.stringify(m(language, key)).slice(1, -1));
    expect(textOf("withdrawal_info", language, FULL)).toContain(JSON.stringify(services).slice(1, -1));
    expect(textOf("withdrawal_info", language, FULL)).toContain(JSON.stringify(regular).slice(1, -1));
  });

  it.each(STARTER_LANGUAGES)("adds the proportional-payment sentence (Art. 14(3)) and the services exclusions (Art. 16(a), (l)) in %s for bookings, on both pages that list exclusions", (language) => {
    for (const role of ["withdrawal_info", "returns_policy"] as const) {
      const withBookings = textOf(role, language, bookingsOnly);
      const without = textOf(role, language, goodsOnly);
      for (const key of ["excl.dated_service", "excl.service_performed"]) {
        expect([role, key, withBookings.includes(JSON.stringify(m(language, key)).slice(1, -1))]).toEqual([role, key, true]);
        expect([role, key, without.includes(JSON.stringify(m(language, key)).slice(1, -1))]).toEqual([role, key, false]);
      }
    }
    expect(textOf("withdrawal_info", language, bookingsOnly)).toContain(JSON.stringify(m(language, "withdrawal.effects.services")).slice(1, -1));
    expect(textOf("withdrawal_info", language, goodsOnly)).not.toContain(JSON.stringify(m(language, "withdrawal.effects.services")).slice(1, -1));
  });

  it.each(STARTER_LANGUAGES)("keeps the terms' own withdrawal paragraph in step with the pages it links to, in %s", (language) => {
    const terms = (facts: LegalFacts) => textOf("terms", language, facts);
    expect(terms(bookingsOnly)).toContain(JSON.stringify(m(language, "terms.withdrawal.services")).slice(1, -1));
    expect(terms(bookingsOnly)).not.toContain(JSON.stringify(m(language, "terms.withdrawal.regular")).slice(1, -1));
    expect(terms(boxesOnly)).toContain(JSON.stringify(m(language, "terms.withdrawal.regular")).slice(1, -1));
    expect(terms(goodsOnly)).not.toContain(JSON.stringify(m(language, "terms.withdrawal.services")).slice(1, -1));
    expect(terms(goodsOnly)).not.toContain(JSON.stringify(m(language, "terms.withdrawal.regular")).slice(1, -1));
  });

  it("asks the store to delete the goods exclusions that do not fit what it sells, as a placeholder the checker blocks publishing over", () => {
    for (const language of STARTER_LANGUAGES) {
      for (const role of ["withdrawal_info", "returns_policy"] as const) {
        const page = legalStarter(role, language, goodsOnly, counter());
        const placeholders = page.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks)).filter((b) => JSON.stringify(b).includes(m(language, "label.exclusionsFit")));
        expect([role, language, placeholders.length]).toEqual([role, language, 1]);
        expect(blockingIssues(pageIssues({ title: page.title, rows: page.rows })).some((i) => i.rule === "placeholder")).toBe(true);
      }
    }
  });
});

describe("the facts", () => {
  it("are assembled from what the server read, with the legal 14 days as the least window", () => {
    expect(FULL).toMatchObject({
      storeName: "Demo Butikk",
      legalName: "Demo Butikk AS",
      country: "NO",
      vat: { number: "NO999888777MVA", registered: true },
      carriers: ["Posten", "PostNord"],
      trackingTools: ["Google Analytics 4", "Meta Pixel"],
      bookingsOn: true,
      deliveriesOn: true,
      visitCounting: true,
      chatAgent: true,
      audience: "both",
    });
    expect(FULL.shipping.map((s) => [s.code, s.rateMinor, s.freeAboveMinor])).toEqual([["NO", 5900, 99900], ["SE", 0, null], ["DE", 990, null]]);
    expect(FULL.returns).toMatchObject({ windowDays: 30, whoPays: "shopper", acceptExcluded: true, b2bReturns: true, address: "Storgata 1, 0155 Oslo" });
  });

  it("uses the return address when there is one, and the postal address when there is not", () => {
    expect(formatReturnAddress({ name: "Lager", street: "Industrivegen 5", postalCode: "1400", city: "Ski", country: "Norge" })).toBe("Lager, Industrivegen 5, 1400 Ski, Norge");
    expect(formatReturnAddress(null)).toBeNull();
    const withAddress = assembleLegalFacts(input({ returnSettings: { ...DEFAULT_RETURN_SETTINGS, returnAddress: { name: "Lager", street: "Industrivegen 5", postalCode: "1400", city: "Ski", country: "Norge" } } }));
    expect(withAddress.returns.address).toBe("Lager, Industrivegen 5, 1400 Ski, Norge");
  });

  it("tidy their text, leave out blanks and repeated carriers, and know a market with no shipping price", () => {
    const facts = assembleLegalFacts(input({ store: { ...input().store, legalName: "  Demo   AS  ", contactEmail: "   " }, carrierNames: ["Posten", " Posten ", ""], shippingRates: [] }));
    expect(facts.legalName).toBe("Demo AS");
    expect(facts.email).toBeNull();
    expect(facts.carriers).toEqual(["Posten"]);
    expect(facts.shipping.every((s) => s.rateMinor === null)).toBe(true);
  });

  it("list what the store still has to give before a starter is useful", () => {
    expect(missingFacts(FULL)).toEqual([]);
    const missing = missingFacts(VARIANTS.empty);
    expect(missing).toEqual(expect.arrayContaining(["the business's legal name", "the organisation number", "the postal address", "the contact email", "the country", "the countries the store sells to"]));
    expect(missingFacts(VARIANTS.consumersStoreShopper)).not.toEqual(expect.arrayContaining([expect.stringContaining("VAT number")]));
    expect(missingFacts(assembleLegalFacts(input({ shippingRates: [] })))).toContain("a shipping price for every country");
  });
});

describe("the languages", () => {
  it("are chosen from the store's main language: the four, else none (English with the extended notice)", () => {
    expect(starterLanguageOf("nb-NO")).toBe("nb");
    expect(starterLanguageOf("no")).toBe("nb");
    expect(starterLanguageOf("nn-NO")).toBe("nb");
    expect(starterLanguageOf("sv-SE")).toBe("sv");
    expect(starterLanguageOf("da-DK")).toBe("da");
    expect(starterLanguageOf("en-IE")).toBe("en");
    expect(starterLanguageOf("de-DE")).toBeNull();
    expect(starterLanguageOf("")).toBeNull();
    expect(starterLanguageOf(null)).toBeNull();
  });

  it("know a role by name, and only the six", () => {
    expect(starterRoleOf("terms")).toBe("terms");
    expect(starterRoleOf("imprint")).toBe("imprint");
    expect(starterRoleOf("accessibility")).toBeNull(); // the statement has its own builder
    expect(starterRoleOf("cart")).toBeNull();
    expect(starterRoleOf(undefined)).toBeNull();
  });

  it("fill a sentence's holes, and leave one it has no value for", () => {
    expect(fill("A {a} and {b}", { a: "1", b: "2" })).toBe("A 1 and 2");
    expect(fill("A {a} and {b}", { a: "1" })).toBe("A 1 and {b}");
  });
});

describe("what needs a person to read it", () => {
  const dir = join(process.cwd(), "src/lib/legal-starters");

  it("lists exactly the files in src/lib/legal-starters, so section 8 of the spec stays true", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => `src/lib/legal-starters/${f}`).sort();
    expect([...LEGAL_REVIEW_MANIFEST.files].sort()).toEqual(files);
    expect(LEGAL_REVIEW_MANIFEST.kinds).toEqual(expect.arrayContaining(["terms", "privacy", "returns_policy", "shipping_policy", "withdrawal_info", "imprint", "review notice"]));
    expect(LEGAL_REVIEW_MANIFEST.languages).toEqual(["nb", "sv", "da", "en"]);
  });

  it("is never machine-translated: the texts import no AI, catalogue or interface-text module", () => {
    for (const file of [...LEGAL_REVIEW_MANIFEST.files, "src/lib/legal-starters.ts"]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const spec of imports) expect([file, /ui-catalog|icu-lite|i18n|ai-provider|\/server\/|translate|ui-text|email-text/.test(spec)]).toEqual([file, false]);
    }
  });

  it("is not in the interface-text catalogue: none of its keys is an English message there", () => {
    const catalogue = readFileSync(join(process.cwd(), "src/lib/ui-catalog.ts"), "utf8");
    expect(catalogue).not.toContain("legal-starters");
    expect(readFileSync(join(process.cwd(), "src/lib/i18n.ts"), "utf8")).not.toContain("legal-starters");
  });
});

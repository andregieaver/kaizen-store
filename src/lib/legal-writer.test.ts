import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assembleLegalFacts, type LegalFactsInput } from "./legal-facts";
import { cellarPassages } from "./legal-passages";
import { jurisdictionsFor } from "./legal-sources";
import { legalStarterSections, starterFactWords } from "./legal-starters";
import {
  annexForm,
  checkLegalDraft,
  factSheet,
  planLegalPage,
  readWriterAnswer,
  renderLegalPage,
  writerMessages,
  writerSettings,
  type DraftSection,
  type SourceText,
} from "./legal-writer";
import { UNTRUSTED_TEXT } from "./prompt-safety";
import { DEFAULT_RETURN_SETTINGS } from "./withdrawal";

/**
 * The AI's legal pages, pure parts (D311, unit L, `docs/ai-autopilot.md` 8.3): the plan, a prompt that carries no fact's value, the checks
 * that refuse each way a draft can go wrong, and the page code makes from a draft that passes, with the facts, the model form and the
 * Sources section put in by code.
 */

const input = (over: Partial<LegalFactsInput> = {}): LegalFactsInput => ({
  store: {
    name: "Demo Butikk",
    legalName: "Demo Butikk AS",
    organisationNumber: "999 888 777",
    contactEmail: "kontakt@demo.example",
    postalAddress: "Storgata 1, 0155 Oslo",
    country: "NO",
    audience: "consumers",
    visitCounting: false,
    modules: [],
    tracking: {},
  },
  tax: { vatNumber: "NO999888777MVA", registered: true },
  markets: [{ code: "NO", currency: "NOK" }],
  shippingRates: [{ marketCode: "NO", currency: "NOK", rateMinor: 5900, freeAboveMinor: 99900 }],
  carrierNames: ["Posten"],
  returnSettings: { ...DEFAULT_RETURN_SETTINGS, windowDays: 30, whoPaysReturn: "shopper", refundWhen: "received", instructions: "Pack the goods well." },
  chatOn: false,
  links: { withdraw: "/s/demo/no/withdraw", cookies: "/s/demo/no/cookies" },
  phone: "+47 22 00 00 00",
  ...over,
});
const FACTS = assembleLegalFacts(input());

const READ = new Date("2026-10-25T08:00:00Z");
const ANNEX = cellarPassages(readFileSync(join(__dirname, "fixtures", "legal", "cellar-crd.eng.xhtml"), "utf8"));
const ART9 = ANNEX.find((p) => p.key === "art_9")!;

const TEXTS: SourceText[] = [
  { sourceKey: "eu-crd", language: "en", readAt: READ, passages: [...ANNEX, { key: "fn_star1", title: "(*1)", text: "Delete as appropriate." }, { key: "art_13", title: "Article 13 — Obligations of the trader in the event of withdrawal", text: "The trader shall reimburse all payments received from the consumer, including, if applicable, the costs of delivery without undue delay and in any event not later than 14 days from the day on which he is informed of the consumer's decision to withdraw from the contract in accordance with Article 11." }] },
  { sourceKey: "no-arl", language: "nb", readAt: READ, passages: [{ key: "21", title: "§ 21. Angrefristen", text: "Angrefristen utløper 14 dager fra den dag avtalen om tjeneste ble inngått, eller den dag forbrukeren får varen i fysisk besittelse." }] },
];

const sheetFor = (language: "nb" | "en") => factSheet(FACTS, starterFactWords(FACTS, language), language);
const planFor = (role: "returns_policy" | "withdrawal_info", language: "nb" | "en") =>
  planLegalPage({ role, language, facts: FACTS, sheet: sheetFor(language), jurisdictions: jurisdictionsFor(FACTS), texts: TEXTS });

const QUOTE_EN = "the consumer shall have a period of 14 days to withdraw from a distance or off-premises contract";

/** A returns policy in English that passes every check. */
function goodReturns(): DraftSection[] {
  return [
    {
      topic: "window",
      blocks: [
        { kind: "statement", text: "You may withdraw from a purchase within 14 days without giving a reason.", cites: [{ source: "eu-crd", passage: "art_9", quote: QUOTE_EN }] },
        { kind: "practical", text: "With us you have {fact:returns.days} days to return goods." },
      ],
    },
    { topic: "how_to", blocks: [{ kind: "practical", text: "Tell us at {fact:seller.email}. {fact:returns.instructions}" }] },
    { topic: "who_pays", blocks: [{ kind: "practical", text: "{fact:return_shipping}" }] },
    { topic: "refund_timing", blocks: [{ kind: "practical", text: "{fact:refund_timing}" }] },
    { topic: "excluded_goods", blocks: [{ kind: "statement", text: "Some goods, such as goods made to measure, cannot be returned under the right of withdrawal.", cites: [{ source: "eu-crd", passage: "art_16", quote: "the supply of goods made to the consumer's specifications or clearly personalised" }] }] },
    { topic: "return_address", blocks: [{ kind: "practical", text: "Send returns to {fact:returns.address}." }] },
    { topic: "withdrawal_link", blocks: [{ kind: "practical", text: "You can also use {link:withdraw}." }] },
  ];
}

describe("the plan", () => {
  it("lists the page's topics, offers each the passages it may rest on in the page's language first, and what tokens it must use", () => {
    const plan = planFor("returns_policy", "nb");
    expect(plan.sections.map((s) => s.topic)).toEqual(["window", "how_to", "who_pays", "refund_timing", "excluded_goods", "return_address", "withdrawal_link"]);
    const window = plan.sections[0];
    expect(window.heading).toBeTruthy();
    expect(window.passages[0]).toBe("no-arl|21");
    expect(window.passages).toContain("eu-crd|art_9");
    expect(window.needs).toEqual(["fact:returns.days"]);
    expect(plan.offered.get("eu-crd|art_9")?.language).toBe("en");
  });

  it("leaves the model withdrawal form to code", () => {
    const plan = planFor("withdrawal_info", "en");
    expect(plan.sections.map((s) => s.topic)).not.toContain("model_form");
    expect(plan.codeTopics).toEqual(["model_form"]);
  });
});

describe("the prompt", () => {
  it("carries the rule about outside text, the passages as data and no value of the store's facts", () => {
    const messages = writerMessages(planFor("returns_policy", "en"), sheetFor("en"), writerSettings(FACTS));
    expect(messages[0].content).toContain(UNTRUSTED_TEXT);
    const user = messages[1].content;
    expect(user).toContain("<source-data>");
    expect(user).toContain(ART9.text.slice(0, 60));
    for (const value of ["Demo Butikk AS", "999 888 777", "kontakt@demo.example", "Storgata 1", "+47 22", "/s/demo/no/withdraw"]) expect(user).not.toContain(value);
    expect(user).toContain("{fact:seller.email}");
  });

  it("asks again with the reasons", () => {
    const messages = writerMessages(planFor("returns_policy", "en"), sheetFor("en"), writerSettings(FACTS), { answer: "{}", problems: ["window: must use {fact:returns.days}."] });
    expect(messages.at(-1)?.content).toContain("must use {fact:returns.days}");
  });
});

describe("reading the answer", () => {
  it("takes JSON in a code fence, and says when there is none or its shape is wrong", () => {
    expect(readWriterAnswer('```json\n{"sections":[{"topic":"window","blocks":[{"kind":"practical","text":"x"}]}]}\n```')).toMatchObject({ ok: true });
    expect(readWriterAnswer("I cannot help")).toEqual({ ok: false, problem: "The answer is not JSON." });
    expect(readWriterAnswer('{"sections":[{"topic":1}]}')).toMatchObject({ ok: false });
  });
});

describe("the checks", () => {
  const plan = planFor("returns_policy", "en");
  const sheet = sheetFor("en");
  const check = (change: (d: DraftSection[]) => void) => {
    const draft = goodReturns();
    change(draft);
    const result = checkLegalDraft(draft, plan, sheet);
    return result.ok ? [] : result.problems;
  };

  it("pass a draft that keeps every rule", () => {
    expect(checkLegalDraft(goodReturns(), plan, sheet)).toEqual({ ok: true });
  });

  it("refuse a quote that is not word for word in its passage, and a passage not offered for the section", () => {
    expect(check((d) => ((d[0].blocks[0] as { cites: { quote: string }[] }).cites[0].quote = "the consumer shall have a period of 30 days to withdraw from any contract"))).toEqual(
      expect.arrayContaining([expect.stringContaining("is not word for word")]),
    );
    expect(check((d) => ((d[0].blocks[0] as { cites: { passage: string }[] }).cites[0].passage = "art_16"))).toEqual(expect.arrayContaining([expect.stringContaining("not offered for this section")]));
  });

  it("refuse a number no cited quote holds, in digits or in words", () => {
    expect(check((d) => ((d[0].blocks[0] as { text: string }).text = "You may withdraw within 30 days."))).toEqual(expect.arrayContaining([expect.stringContaining("the number 30")]));
    expect(check((d) => ((d[0].blocks[0] as { text: string }).text = "You may withdraw within thirty days."))).toEqual(expect.arrayContaining([expect.stringContaining("the number 30")]));
    expect(check((d) => ((d[3].blocks[0] as { text: string }).text = "{fact:refund_timing} Usually within 5 days."))).toEqual(expect.arrayContaining([expect.stringContaining("the number 5")]));
  });

  it("refuse an address written out, a token not offered, markup, the ODR platform and a claim", () => {
    expect(check((d) => ((d[1].blocks[0] as { text: string }).text = "Write to returns@shop.example. {fact:returns.instructions}"))).toEqual(expect.arrayContaining([expect.stringContaining("written out")]));
    expect(check((d) => ((d[1].blocks[0] as { text: string }).text = "Write to {fact:seller.fax}."))).toEqual(expect.arrayContaining([expect.stringContaining("not a token offered")]));
    expect(check((d) => ((d[1].blocks[0] as { text: string }).text = "Tell us at <b>{fact:seller.email}</b>."))).toEqual(expect.arrayContaining([expect.stringContaining("markup")]));
    expect(check((d) => d[4].blocks.push({ kind: "practical", text: "Or use the ODR platform via {link:withdraw}." }))).toEqual(expect.arrayContaining([expect.stringContaining("repealed")]));
    expect(check((d) => ((d[1].blocks[0] as { text: string }).text = "We have the best price. Tell us at {fact:seller.email}."))).toEqual(expect.arrayContaining([expect.stringContaining("makes a claim")]));
  });

  it("refuse a section out of order, a fact the section must use, a statement without a source and a practical block without a fact", () => {
    expect(check((d) => d.reverse())).toEqual(expect.arrayContaining([expect.stringContaining("exactly, in order")]));
    expect(check((d) => ((d[0].blocks[1] as { text: string }).text = "You have a month to return goods."))).toEqual(expect.arrayContaining(["window: must use {fact:returns.days}."]));
    expect(check((d) => delete (d[4].blocks[0] as { cites?: unknown }).cites)).toEqual(expect.arrayContaining([expect.stringContaining("must cite a passage")]));
    expect(check((d) => d[1].blocks.push({ kind: "practical", text: "We are happy to help." }))).toEqual(expect.arrayContaining([expect.stringContaining("must use a token")]));
  });
});

describe("the page", () => {
  it("fills every token from the store's facts, and lists the passages cited with the day each was read", () => {
    const plan = planFor("returns_policy", "en");
    const page = renderLegalPage({ plan, sections: goodReturns(), sheet: sheetFor("en"), starterForm: null, writtenAt: new Date("2026-10-25T12:00:00Z") });
    const text = JSON.stringify(page.sections);
    expect(text).toContain("With us you have 30 days to return goods.");
    expect(text).toContain("kontakt@demo.example");
    expect(text).toContain("Storgata 1, 0155 Oslo");
    expect(text).toContain("[the withdrawal form](/s/demo/no/withdraw)");
    expect(text).not.toContain("{fact:");
    expect(page.missing).toEqual([]);
    const sources = page.sections.at(-1)!;
    expect(sources.topic).toBe("sources");
    expect(JSON.stringify(sources)).toContain("prepared with AI on 25 October 2026");
    expect(JSON.stringify(sources)).toContain("Directive 2011/83/EU on consumer rights, Article 9 — Right of withdrawal (read 25 October 2026)");
  });

  it("shows a fact the store has not given as the starters' placeholder", () => {
    const facts = assembleLegalFacts(input({ returnSettings: { ...DEFAULT_RETURN_SETTINGS, instructions: "" } }));
    const sheet = factSheet(facts, starterFactWords(facts, "en"), "en");
    const plan = planLegalPage({ role: "returns_policy", language: "en", facts, sheet, jurisdictions: jurisdictionsFor(facts), texts: TEXTS });
    const page = renderLegalPage({ plan, sections: goodReturns(), sheet, starterForm: null, writtenAt: READ });
    expect(page.missing).toEqual([expect.stringMatching(/^\[\[Add: /)]);
  });

  it("copies the model withdrawal form from the directive, with the trader's details where it asks for them", () => {
    const annex = ANNEX.find((p) => p.key === "anx_I")!.text;
    const blocks = annexForm(annex, "Delete as appropriate.", sheetFor("en"))!;
    expect(blocks[0]).toEqual({ p: expect.stringMatching(/^B\. Model withdrawal form/) });
    const items = (blocks[1] as { ul: string[] }).ul;
    expect(items[0]).toBe("To Demo Butikk AS, Storgata 1, 0155 Oslo, kontakt@demo.example:");
    expect(items.at(-1)).toBe("Date");
    expect(blocks[2]).toEqual({ p: "(*) Delete as appropriate." });
  });

  it("puts the form in the withdrawal information: the directive's in English, the starter's in Norwegian", () => {
    const writtenAt = READ;
    const en = planFor("withdrawal_info", "en");
    const enPage = renderLegalPage({ plan: en, sections: [], sheet: sheetFor("en"), starterForm: null, writtenAt });
    expect(JSON.stringify(enPage.sections.find((s) => s.topic === "model_form"))).toContain("B. Model withdrawal form");
    const nb = planFor("withdrawal_info", "nb");
    const starterForm = legalStarterSections("withdrawal_info", "nb", FACTS).find((s) => s.topic === "model_form")!;
    const nbPage = renderLegalPage({ plan: nb, sections: [], sheet: sheetFor("nb"), starterForm, writtenAt });
    expect(nbPage.sections.find((s) => s.topic === "model_form")?.blocks).toEqual(starterForm.blocks);
    expect(nbPage.sections.at(-1)?.heading).toBe("Kilder");
  });
});

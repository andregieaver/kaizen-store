/**
 * The AI's legal pages, pure parts (D311, unit L, `docs/ai-autopilot.md` 8.3): what a page holds (`planLegalPage()`: its topics, in order,
 * and for each the passages of official text it may rest on), what the model is told (`writerMessages()`), how its answer is read
 * (`readWriterAnswer()`) and checked (`checkLegalDraft()`), and how the page is made from it (`renderLegalPage()`), with every fact, link and
 * body filled by code from the store's own facts and the register, the model withdrawal form copied from the law, and a Sources section.
 *
 * The model writes sentences only. It never writes a name, number, address, email, web address, price or date (a token stands for each);
 * every statement of the law cites a passage it was given and quotes it word for word; a number it writes must be in a quote it cites.
 * Free of server-only modules; the job is `src/server/legal-writer.ts`.
 */
import { z } from "zod";

import { findClaims } from "./claims";
import type { LegalFacts } from "./legal-facts";
import { normalisedLegalText, type Passage } from "./legal-passages";
import {
  CONSUMER_AUTHORITIES,
  DISPUTE_BODIES,
  LEGAL_SOURCES_BY_KEY,
  PRIVACY_AUTHORITIES,
  isCoveredCountry,
  readingLanguage,
  refsFor,
  type Jurisdiction,
  type LegalBody,
  type LegalLanguage,
} from "./legal-sources";
import { CONDITIONAL_TOPICS, REQUIRED_TOPICS, STARTER_TEXTS, starterTitle, type RenderedBlock, type RenderedSection, type StarterFactWords, type StarterRole } from "./legal-starters";
import { UNTRUSTED_TEXT } from "./prompt-safety";

/** A text of a source as read (`currentLegalTexts()`): its passages in one language. */
export type SourceText = { sourceKey: string; language: LegalLanguage; readAt: Date; passages: Passage[] };

/** Topics code writes itself, never the model. */
const CODE_TOPICS = new Set(["withdrawal_info.model_form"]);

/** What each topic must say, for the model (English; the model writes in the page's language). */
export const TOPIC_BRIEFS: Readonly<Record<string, string>> = {
  "terms.seller": "Who the seller is: legal name, organisation number, address, email and phone.",
  "terms.products_prices": "How products and prices are described: prices include VAT, the currencies prices are shown in.",
  "terms.vat_shipping_costs": "That prices include VAT, and what delivery costs to each country (the list of rates).",
  "terms.order_contract": "How an order is placed and when the contract is formed; the confirmation the buyer receives.",
  "terms.payment": "How payment works and that no fee is charged for using a means of payment beyond what the law allows.",
  "terms.delivery": "Where the store delivers, when goods are delivered if no time is agreed, and when the risk passes to the buyer.",
  "terms.withdrawal": "The consumer's right to withdraw from a distance contract: the period, how to use it, and where the withdrawal form is.",
  "terms.returns_link": "The store's return window and who pays for returns, pointing to the returns policy.",
  "terms.conformity": "The seller's liability when goods are not in conformity, and the remedies the consumer has.",
  "terms.complaints": "How and when to complain about a fault, and how to contact the store about it.",
  "terms.disputes": "Where a consumer can take a complaint that the store and the consumer cannot settle (the bodies listed).",
  "terms.privacy_link": "That personal data is handled as the privacy statement describes.",
  "terms.law_and_changes": "That the consumer's rights under mandatory law cannot be taken away by these terms; which country's law applies.",
  "terms.bookings_subscriptions": "Rules for bookings of services and for regular deliveries, where the store offers them.",
  "terms.businesses": "What differs when the buyer is a business rather than a consumer.",
  "privacy.controller": "Who is responsible for the personal data (the controller), with name and address.",
  "privacy.contact": "How to contact the controller about personal data.",
  "privacy.purposes_basis": "Why personal data is processed and on what legal basis.",
  "privacy.recipients": "Who receives personal data (the platform, payment, email, carriers, tracking tools the store uses).",
  "privacy.transfers": "Whether personal data is transferred outside the EU/EEA and on what basis.",
  "privacy.retention": "How long personal data is kept, or how the period is decided.",
  "privacy.rights": "The person's rights: access, rectification, erasure, restriction, portability and objection.",
  "privacy.consent_withdrawal": "That consent can be withdrawn at any time, without affecting what was done before.",
  "privacy.complaint_authority": "The right to complain to the data protection authority (named).",
  "privacy.obligation_to_provide": "Whether giving the data is required for the contract, and what happens if it is not given.",
  "privacy.automated_decisions": "Whether automated decision-making, including profiling, is used.",
  "privacy.cookies_link": "Where the store's cookie information is.",
  "returns_policy.window": "How many days the customer has to return goods, and the statutory withdrawal period it builds on.",
  "returns_policy.how_to": "How to return goods: the steps, and the store's own instructions.",
  "returns_policy.who_pays": "Who pays for sending goods back.",
  "returns_policy.refund_timing": "When and how the refund is paid.",
  "returns_policy.excluded_goods": "Goods that cannot be returned under the right of withdrawal.",
  "returns_policy.return_address": "Where returns are sent.",
  "returns_policy.withdrawal_link": "Where the withdrawal form is.",
  "returns_policy.businesses": "What applies to returns from business buyers.",
  "shipping_policy.markets": "The countries the store delivers to.",
  "shipping_policy.rates": "What delivery costs (the list of rates), collection points and local delivery where offered.",
  "shipping_policy.carriers": "The carriers the store uses.",
  "shipping_policy.delivery_time": "When goods are delivered if no time is agreed, and what the customer can do if they are late.",
  "shipping_policy.tracking": "How the customer can follow the delivery.",
  "shipping_policy.outside_eu": "What applies to deliveries outside the EU/EEA (customs, duties).",
  "shipping_policy.damaged_goods": "What to do with goods damaged in transport, and when the risk passes to the customer.",
  "shipping_policy.contact": "How to contact the store about a delivery.",
  "withdrawal_info.right": "The right of withdrawal: its period and when the period starts.",
  "withdrawal_info.how": "How to withdraw: an unequivocal statement, the model form or the online withdrawal, and where to send it.",
  "withdrawal_info.effects": "What happens after withdrawal: the refund and its timing, returning the goods and its cost, the customer's liability.",
  "withdrawal_info.exclusions": "When the right of withdrawal does not apply.",
  "imprint.legal_name": "The business's legal name.",
  "imprint.org_number": "The organisation number.",
  "imprint.vat_number": "The VAT registration.",
  "imprint.address": "The geographic address.",
  "imprint.email": "The email address.",
  "imprint.phone": "The phone number.",
  "imprint.register": "The trade register the business is entered in.",
  "imprint.supervisory_authority": "The authority that supervises consumer law (named).",
};

/** What a token names, for the model: it sees names and descriptions, never the values. */
const TOKEN_ABOUT: Readonly<Record<string, string>> = {
  "fact:store": "the store's name",
  "fact:seller.name": "the seller's legal name",
  "fact:seller.number": "the organisation number",
  "fact:seller.vat": "the VAT number",
  "fact:seller.address": "the seller's address",
  "fact:seller.email": "the seller's email address",
  "fact:seller.phone": "the seller's phone number",
  "fact:seller.country": "the seller's country",
  "fact:markets": "the countries the store sells to",
  "fact:currencies": "the currencies prices are shown in",
  "fact:returns.days": "the store's return window in days (a number)",
  "fact:withdrawal.days": "the statutory withdrawal period in days (a number)",
  "fact:returns.address": "where returns are sent",
  "fact:returns.instructions": "the store's own return instructions (a sentence or more)",
  "fact:return_shipping": "a whole sentence saying who pays for sending goods back",
  "fact:refund_timing": "a whole sentence saying when the refund is paid",
  "fact:withdrawal_return_cost": "a whole sentence saying who pays the cost of returning goods after withdrawal",
  "fact:vat": "a whole sentence giving the VAT registration",
  "list:shipping.rates": "the delivery rates, one line per country",
  "list:pickup": "the collection points and their price",
  "list:local": "the local delivery areas and their price",
  "list:carriers": "the carriers' names",
  "list:tracking.tools": "the tracking tools the store uses (they load only with consent)",
  "link:withdraw": "a link to the withdrawal form",
  "link:cookies": "a link to the cookie information",
  "body:disputes": "the bodies a consumer may complain to",
  "body:privacy_authority": "the data protection authority",
  "body:consumer_authority": "the consumer authority",
};

/** Tokens a topic must hold, so the store's facts are on the page and never the model's version of them. */
const TOPIC_NEEDS: Readonly<Record<string, readonly string[]>> = {
  "terms.seller": ["fact:seller.name", "fact:seller.address", "fact:seller.email"],
  "terms.vat_shipping_costs": ["list:shipping.rates"],
  "terms.withdrawal": ["fact:withdrawal.days", "link:withdraw"],
  "terms.returns_link": ["fact:returns.days", "fact:return_shipping"],
  "terms.disputes": ["body:disputes"],
  "privacy.controller": ["fact:seller.name"],
  "privacy.contact": ["fact:seller.email"],
  "privacy.complaint_authority": ["body:privacy_authority"],
  "privacy.cookies_link": ["link:cookies"],
  "returns_policy.window": ["fact:returns.days"],
  "returns_policy.who_pays": ["fact:return_shipping"],
  "returns_policy.refund_timing": ["fact:refund_timing"],
  "returns_policy.return_address": ["fact:returns.address"],
  "returns_policy.withdrawal_link": ["link:withdraw"],
  "shipping_policy.markets": ["fact:markets"],
  "shipping_policy.rates": ["list:shipping.rates"],
  "shipping_policy.carriers": ["list:carriers"],
  "shipping_policy.contact": ["fact:seller.email"],
  "withdrawal_info.right": ["fact:withdrawal.days"],
  "withdrawal_info.how": ["fact:seller.email", "link:withdraw"],
  "withdrawal_info.effects": ["fact:withdrawal_return_cost"],
  "imprint.legal_name": ["fact:seller.name"],
  "imprint.org_number": ["fact:seller.number"],
  "imprint.vat_number": ["fact:vat"],
  "imprint.address": ["fact:seller.address"],
  "imprint.email": ["fact:seller.email"],
  "imprint.phone": ["fact:seller.phone"],
  "imprint.supervisory_authority": ["body:consumer_authority"],
};

// ---------------------------------------------------------------------------
// The fact sheet: what each token stands for
// ---------------------------------------------------------------------------

export type FactSheet = {
  /** Values and settings sentences by token (`fact:…`); null where the store holds none. */
  facts: Record<string, string | null>;
  /** The placeholder shown where a value is missing. */
  missing: Record<string, string>;
  lists: Record<string, string[]>;
  links: Record<string, { href: string; label: string } | null>;
  bodies: Record<string, readonly LegalBody[]>;
};

/** The tokens of a sheet that can be used (a list or link the store does not have is not offered). */
export function offeredTokens(sheet: FactSheet): string[] {
  return [
    ...Object.keys(sheet.facts),
    ...Object.entries(sheet.lists)
      .filter(([, items]) => items.length > 0)
      .map(([key]) => key),
    ...Object.entries(sheet.links)
      .filter(([, link]) => link !== null)
      .map(([key]) => key),
    ...Object.keys(sheet.bodies),
  ];
}

export function factSheet(facts: LegalFacts, words: StarterFactWords, language: LegalLanguage): FactSheet {
  const w = LEGAL_AI_WORDS[language];
  const country = isCoveredCountry(facts.country) ? facts.country : null;
  return {
    facts: {
      ...Object.fromEntries(Object.entries(words.values).map(([key, value]) => [`fact:${key}`, value])),
      ...Object.fromEntries(Object.entries(words.sentences).map(([key, value]) => [`fact:${key}`, value])),
    },
    missing: Object.fromEntries(Object.entries(words.missing).map(([key, value]) => [`fact:${key}`, value])),
    lists: Object.fromEntries(Object.entries(words.lists).map(([key, items]) => [`list:${key}`, items])),
    links: {
      "link:withdraw": facts.links.withdraw ? { href: facts.links.withdraw, label: w.withdrawLink } : null,
      "link:cookies": facts.links.cookies ? { href: facts.links.cookies, label: w.cookiesLink } : null,
    },
    bodies: country
      ? { "body:disputes": DISPUTE_BODIES[country], "body:privacy_authority": [PRIVACY_AUTHORITIES[country]], "body:consumer_authority": [CONSUMER_AUTHORITIES[country]] }
      : {},
  };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/** A passage the model may cite, with the text it is checked against. */
export type Offered = { source: string; passage: string; language: LegalLanguage; readAt: Date; title: string; text: string };

export type PlanSection = { topic: string; heading: string; brief: string; passages: string[] /* `${source}|${passage}` */; needs: string[] };

export type LegalPlan = {
  role: StarterRole;
  language: LegalLanguage;
  title: string;
  /** The topics the model writes, in order. */
  sections: PlanSection[];
  /** Every passage offered, by `${source}|${passage}`. */
  offered: Map<string, Offered>;
  /** Topics code writes (the model withdrawal form). */
  codeTopics: string[];
};

const passageKey = (source: string, passage: string) => `${source}|${passage}`;

/** The topics of a kind of page for a store, in the starters' order (`REQUIRED_TOPICS`, then the conditional ones that apply). */
export function pageTopics(role: StarterRole, facts: LegalFacts): string[] {
  const conditional = Object.entries(CONDITIONAL_TOPICS[role])
    .filter(([, applies]) => applies(facts))
    .map(([topic]) => topic);
  return [...REQUIRED_TOPICS[role], ...conditional];
}

/** What a page holds and what each topic may rest on, from the texts as read. */
export function planLegalPage(input: {
  role: StarterRole;
  language: LegalLanguage;
  facts: LegalFacts;
  sheet: FactSheet;
  jurisdictions: readonly Jurisdiction[];
  texts: readonly SourceText[];
}): LegalPlan {
  const { role, language } = input;
  const byText = new Map(input.texts.map((t) => [`${t.sourceKey}|${t.language}`, t]));
  const offered = new Map<string, Offered>();
  const tokens = new Set(offeredTokens(input.sheet));
  const offer = (topicKey: string): string[] => {
    const keys: string[] = [];
    for (const ref of refsFor(topicKey, input.jurisdictions, language)) {
      const source = LEGAL_SOURCES_BY_KEY[ref.source];
      const text = byText.get(`${ref.source}|${readingLanguage(source, language)}`);
      if (!text) continue;
      for (const key of ref.passages) {
        const passage = text.passages.find((p) => p.key === key);
        if (!passage) continue;
        const id = passageKey(ref.source, key);
        offered.set(id, { source: ref.source, passage: key, language: text.language, readAt: text.readAt, title: passage.title, text: passage.text });
        keys.push(id);
      }
    }
    return keys;
  };
  const sections: PlanSection[] = [];
  const codeTopics: string[] = [];
  for (const topic of pageTopics(role, input.facts)) {
    const topicKey = `${role}.${topic}`;
    const passages = offer(topicKey);
    if (CODE_TOPICS.has(topicKey)) {
      codeTopics.push(topic);
      continue;
    }
    sections.push({
      topic,
      heading: STARTER_TEXTS[language].m[`h.${role}.${topic}`] ?? topic,
      brief: TOPIC_BRIEFS[topicKey] ?? topic,
      passages,
      needs: (TOPIC_NEEDS[topicKey] ?? []).filter((t) => tokens.has(t)),
    });
  }
  return { role, language, title: starterTitle(role, language), sections, offered, codeTopics };
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

const LANGUAGE_NAMES: Record<LegalLanguage, string> = { nb: "Norwegian (bokmål)", sv: "Swedish", da: "Danish", en: "English" };

/** Longest passage text given to the model; the quote is checked against the whole passage. */
const PASSAGE_CHARS = 6000;

const SYSTEM = [
  "You write one legal page for an online store, for its customers, in the language you are told. You write only from the official legal text given between <source-data> markers, never from what you remember.",
  "Rules:",
  '- Each block is "statement" (what the law gives or requires) or "practical" (how this store does something). A statement cites at least one passage offered for its section, with a quote of 20 to 300 characters copied exactly from that passage, in the passage\'s own language.',
  "- Write every fact, link and body as its token, exactly as listed, in braces: {fact:seller.name}. Never write a name, organisation number, address, email address, web address, phone number, price or date yourself. A practical block uses at least one token.",
  '- A list token such as {list:shipping.rates} is the whole text of a block of its own. A block of kind "list" has items instead of text.',
  "- Write no digits and no number words except a number that appears in a quote the same block cites. Never write article or section numbers or the names of acts: the page lists its sources itself.",
  "- Use every token listed under a section's needs. Write each section only about its brief; do not repeat other sections.",
  "- Never mention an online dispute resolution platform. Promise nothing the facts do not say, and write no marketing.",
  "- Plain sentences for consumers: no HTML, no markdown, no headings (each section has one already).",
  'Answer JSON only: {"sections":[{"topic":"...","blocks":[{"kind":"statement","text":"...","cites":[{"source":"...","passage":"...","quote":"..."}]},{"kind":"practical","text":"..."},{"kind":"list","items":["..."],"cites":[]}]}]}, one entry per section, in the order given.',
  UNTRUSTED_TEXT,
].join("\n");

export type ChatTurn = { role: "system" | "user" | "assistant"; content: string };

export type WriterSettings = Record<string, string | boolean>;

/** The store's settings the model may know as they are (no person's or business's details: those are tokens). */
export function writerSettings(facts: LegalFacts): WriterSettings {
  return {
    sellsTo: facts.audience,
    bookings: facts.bookingsOn,
    regularDeliveries: facts.deliveriesOn,
    returnShippingPaidBy: facts.returns.whoPays === "store" ? "the store" : "the customer",
    refundPaid: facts.returns.refundWhen === "request" ? "after the withdrawal is received" : "after the goods are back or shown sent",
    returnWindowLongerThanTheLaw: facts.returns.windowDays > 14,
    acceptsReturnsOfExcludedGoods: facts.returns.acceptExcluded,
    businessReturns: facts.returns.b2bReturns,
    vatRegistered: facts.vat.registered !== false,
    chatAssistant: facts.chatAgent,
    cookielessVisitCounting: facts.visitCounting,
  };
}

/** The messages for one page in one language; `retry` adds the last answer and what was wrong with it. */
export function writerMessages(plan: LegalPlan, sheet: FactSheet, settings: WriterSettings, retry?: { answer: string; problems: string[] }): ChatTurn[] {
  const tokens = offeredTokens(sheet);
  const brief = {
    page: plan.title,
    language: LANGUAGE_NAMES[plan.language],
    storeSettings: settings,
    tokens: tokens.map((t) => ({ token: `{${t}}`, about: TOKEN_ABOUT[t] ?? t })),
    sections: plan.sections.map((s) => ({
      topic: s.topic,
      heading: s.heading,
      brief: s.brief,
      needs: s.needs.map((t) => `{${t}}`),
      passages: s.passages.map((key) => {
        const o = plan.offered.get(key)!;
        return { source: o.source, passage: o.passage, title: o.title };
      }),
    })),
  };
  const data = [...plan.offered.values()]
    .map((o) => `[${o.source} ${o.passage}] ${o.title} (${o.language})\n${o.text.length > PASSAGE_CHARS ? `${o.text.slice(0, PASSAGE_CHARS)} …` : o.text}`)
    .join("\n\n");
  const messages: ChatTurn[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `${JSON.stringify(brief)}\n\n<source-data>\n${data}\n</source-data>` },
  ];
  if (retry) {
    messages.push({ role: "assistant", content: retry.answer });
    messages.push({ role: "user", content: `The answer was refused for these reasons. Write the whole answer again, fixing each:\n- ${retry.problems.join("\n- ")}` });
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Reading and checking the answer
// ---------------------------------------------------------------------------

const cite = z.object({ source: z.string(), passage: z.string(), quote: z.string() });
const block = z.union([
  z.object({ kind: z.enum(["statement", "practical"]), text: z.string(), cites: z.array(cite).optional() }),
  z.object({ kind: z.literal("list"), items: z.array(z.string()), cites: z.array(cite).optional() }),
]);
const answerShape = z.object({ sections: z.array(z.object({ topic: z.string(), blocks: z.array(block) })) });

export type DraftBlock = z.infer<typeof block>;
export type DraftSection = { topic: string; blocks: DraftBlock[] };

/** The model's answer as JSON (a code fence or words around it are dropped), or why it cannot be read. */
export function readWriterAnswer(text: string): { ok: true; sections: DraftSection[] } | { ok: false; problem: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, problem: "The answer is not JSON." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ok: false, problem: "The answer is not valid JSON." };
  }
  const shaped = answerShape.safeParse(parsed);
  if (!shaped.success) return { ok: false, problem: "The answer does not have the shape asked for (sections of blocks)." };
  return { ok: true, sections: shaped.data.sections };
}

const TOKEN = /\{((?:fact|list|link|body):[a-z_.]+)\}/g;
const TEXT_MAX = 1200;
const ITEM_MAX = 400;
const BLOCKS_MAX = 12;
const ITEMS_MAX = 15;
const QUOTE_MIN = 20;
const QUOTE_MAX = 300;

/** The online dispute resolution platform, repealed in 2025, in the four languages. */
const ODR = /\bODR\b|online dispute resolution|tvisteløsningsplattform|plattform(en)? for (online )?tvisteløsning|tvistlösning online|onlinetvistlösning|onlinetvistbilæggelse|platform for online tvistbilæggelse/i;

/** Number words (2 and up: "one", "en", "et" are also articles and pronouns), by value, in the four languages. */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14, thirty: 30,
  två: 2, tre: 3, fyra: 4, fem: 5, sex: 6, sju: 7, åtta: 8, nio: 9, tio: 10, elva: 11, tolv: 12, fjorton: 14, trettio: 30,
  to: 2, fire: 4, seks: 6, syv: 7, otte: 8, ni: 9, ti: 10, elleve: 11, fjorten: 14, tredive: 30,
  åtte: 8, tretti: 30,
};
/** Words that are numbers in the page's language only (English "to" and "fire" are not). */
const LANGUAGE_ONLY: Readonly<Record<string, readonly LegalLanguage[]>> = { to: ["da", "nb"], fire: ["da", "nb"], ni: ["da", "nb"], ti: ["da", "nb"], sex: ["sv"] };

function numbersIn(text: string, language: LegalLanguage | "any"): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d+/g)) out.push(Number(m[0]));
  for (const m of text.toLowerCase().matchAll(/[a-zåäöæø]+/g)) {
    const value = NUMBER_WORDS[m[0]];
    if (value === undefined) continue;
    const only = LANGUAGE_ONLY[m[0]];
    if (only && language !== "any" && !only.includes(language)) continue;
    out.push(value);
  }
  return out;
}

/** What is wrong with a piece of the model's own words (tokens taken out). */
function wordsProblems(text: string, where: string, offered: ReadonlySet<string>, quotes: readonly string[], language: LegalLanguage, max: number): string[] {
  const problems: string[] = [];
  if (text.trim() === "") problems.push(`${where}: empty.`);
  if (text.length > max) problems.push(`${where}: longer than ${max} characters.`);
  for (const m of text.matchAll(TOKEN)) if (!offered.has(m[1])) problems.push(`${where}: {${m[1]}} is not a token offered.`);
  const bare = text.replace(TOKEN, " ");
  if (/[{}]/.test(bare)) problems.push(`${where}: a brace that is not a listed token.`);
  if (/[<>]|\]\(|\*\*|^\s*#/.test(bare)) problems.push(`${where}: markup (HTML or markdown) instead of plain text.`);
  if (/@|https?:|www\./i.test(bare)) problems.push(`${where}: an email or web address written out instead of its token.`);
  if (ODR.test(bare)) problems.push(`${where}: names the online dispute resolution platform, which was repealed.`);
  const allowed = new Set(quotes.flatMap((q) => numbersIn(q, "any")));
  for (const n of numbersIn(bare, language)) if (!allowed.has(n)) problems.push(`${where}: the number ${n} is in no quote the block cites; write it only from a quote, or not at all.`);
  for (const claim of findClaims(bare)) problems.push(`${where}: "${claim.phrase}" makes a claim (${claim.kind}) the store has not made.`);
  return problems;
}

/** Checks a draft against its plan; the problems are worded for the model's second try. */
export function checkLegalDraft(sections: readonly DraftSection[], plan: LegalPlan, sheet: FactSheet): { ok: true } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const offeredTokenSet = new Set(offeredTokens(sheet));
  const expected = plan.sections.map((s) => s.topic);
  const got = sections.map((s) => s.topic);
  if (expected.join(",") !== got.join(",")) problems.push(`The sections must be exactly, in order: ${expected.join(", ")} (got: ${got.join(", ") || "none"}).`);
  for (const section of sections) {
    const planned = plan.sections.find((s) => s.topic === section.topic);
    if (!planned) continue;
    const where = section.topic;
    if (section.blocks.length === 0) problems.push(`${where}: no blocks.`);
    if (section.blocks.length > BLOCKS_MAX) problems.push(`${where}: more than ${BLOCKS_MAX} blocks.`);
    const used = new Set<string>();
    section.blocks.forEach((b, i) => {
      const at = `${where}, block ${i + 1}`;
      const texts = b.kind === "list" ? b.items : [b.text];
      for (const t of texts) for (const m of t.matchAll(TOKEN)) used.add(m[1]);
      // Each cite: offered for this section, its quote word for word in the passage.
      const quotes: string[] = [];
      for (const c of b.cites ?? []) {
        const id = passageKey(c.source, c.passage);
        const offered = plan.offered.get(id);
        if (!offered || !planned.passages.includes(id)) {
          problems.push(`${at}: cites ${c.source} ${c.passage}, which was not offered for this section.`);
          continue;
        }
        const quote = normalisedLegalText(c.quote);
        if (quote.length < QUOTE_MIN || quote.length > QUOTE_MAX) problems.push(`${at}: a quote must be ${QUOTE_MIN} to ${QUOTE_MAX} characters.`);
        else if (!offered.text.includes(quote)) problems.push(`${at}: the quote "${quote.slice(0, 80)}" is not word for word in ${c.source} ${c.passage}.`);
        else quotes.push(quote);
      }
      if (b.kind === "statement" && (b.cites ?? []).length === 0) problems.push(`${at}: a statement must cite a passage.`);
      if (b.kind === "practical") {
        if (!/\{(?:fact|list|link|body):/.test(b.text)) problems.push(`${at}: a practical block must use a token for the store's facts.`);
        if ((b.cites ?? []).length > 0) problems.push(`${at}: a practical block cites nothing; make it a statement.`);
      }
      if (b.kind === "list") {
        if (b.items.length === 0 || b.items.length > ITEMS_MAX) problems.push(`${at}: a list has 1 to ${ITEMS_MAX} items.`);
        b.items.forEach((item, j) => problems.push(...wordsProblems(item, `${at}, item ${j + 1}`, offeredTokenSet, quotes, plan.language, ITEM_MAX)));
      } else {
        // A list token stands alone.
        const lists = [...b.text.matchAll(TOKEN)].filter((m) => m[1].startsWith("list:"));
        if (lists.length > 0 && b.text.trim() !== `{${lists[0][1]}}`) problems.push(`${at}: a list token must be the whole text of its block.`);
        problems.push(...wordsProblems(b.text, at, offeredTokenSet, quotes, plan.language, TEXT_MAX));
      }
    });
    for (const need of planned.needs) if (!used.has(need)) problems.push(`${where}: must use {${need}}.`);
  }
  return problems.length > 0 ? { ok: false, problems: [...new Set(problems)].slice(0, 40) } : { ok: true };
}

// ---------------------------------------------------------------------------
// Making the page
// ---------------------------------------------------------------------------

/** Words an AI page needs beyond the starters' (hand-written nb, sv, da and en). */
export const LEGAL_AI_WORDS: Readonly<
  Record<LegalLanguage, { sources: string; prepared: string; read: string; withdrawLink: string; cookiesLink: string; englishPage: string }>
> = {
  en: {
    sources: "Sources",
    prepared: "This page was prepared with AI on {date} from the official sources listed below.",
    read: "read {date}",
    withdrawLink: "the withdrawal form",
    cookiesLink: "our page about cookies",
    englishPage: "This page is in English because it cannot yet be written in the store's own language.",
  },
  nb: {
    sources: "Kilder",
    prepared: "Denne siden ble utarbeidet med KI {date} ut fra de offisielle kildene nedenfor.",
    read: "lest {date}",
    withdrawLink: "angreskjemaet",
    cookiesLink: "siden vår om informasjonskapsler",
    englishPage: "This page is in English because it cannot yet be written in the store's own language.",
  },
  sv: {
    sources: "Källor",
    prepared: "Den här sidan har tagits fram med AI den {date} utifrån de officiella källorna nedan.",
    read: "läst {date}",
    withdrawLink: "ångerformuläret",
    cookiesLink: "vår sida om kakor",
    englishPage: "This page is in English because it cannot yet be written in the store's own language.",
  },
  da: {
    sources: "Kilder",
    prepared: "Denne side er udarbejdet med AI den {date} ud fra de officielle kilder nedenfor.",
    read: "læst {date}",
    withdrawLink: "fortrydelsesformularen",
    cookiesLink: "vores side om cookies",
    englishPage: "This page is in English because it cannot yet be written in the store's own language.",
  },
};

const LOCALES: Record<LegalLanguage, string> = { nb: "nb-NO", sv: "sv-SE", da: "da-DK", en: "en-GB" };

const dateIn = (date: Date, language: LegalLanguage) => new Intl.DateTimeFormat(LOCALES[language], { dateStyle: "long", timeZone: "UTC" }).format(date);

const listIn = (items: readonly string[], language: LegalLanguage) => {
  try {
    return new Intl.ListFormat(LOCALES[language], { style: "long", type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
};

/** A sentence's tokens filled; `missing` collects the placeholders used. */
function fillTokens(text: string, sheet: FactSheet, language: LegalLanguage, missing: Set<string>): string {
  return text.replace(TOKEN, (_whole, token: string) => {
    if (token.startsWith("fact:")) {
      const value = sheet.facts[token];
      if (value) return value;
      const placeholder = sheet.missing[token] ?? `[[${token}]]`;
      missing.add(placeholder);
      return placeholder;
    }
    if (token.startsWith("link:")) {
      const link = sheet.links[token];
      return link ? `[${link.label}](${link.href})` : "";
    }
    if (token.startsWith("body:")) return listIn((sheet.bodies[token] ?? []).map((b) => `[${b.name}](${b.url})`), language);
    return listIn(sheet.lists[token] ?? [], language);
  });
}

export type CitedPassage = { source: string; passage: string };

/** The model withdrawal form from the directive's Annex I(B) as read (sv, da, en), with the trader's details where the annex asks for them. */
export function annexForm(annex: string, note: string | null, sheet: FactSheet): RenderedBlock[] | null {
  const start = annex.search(/ B\. /);
  if (start < 0) return null;
  const segments = annex
    .slice(start + 1)
    .replace(/\(\s*\*\s*1\s*\)/g, "(*)")
    .split(/ - /)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length < 4) return null;
  const trader = [sheet.facts["fact:seller.name"], sheet.facts["fact:seller.address"], sheet.facts["fact:seller.email"]].map((v, i) =>
    v ? v : (sheet.missing[["fact:seller.name", "fact:seller.address", "fact:seller.email"][i]] ?? ""),
  );
  const items = segments.slice(1).map((item) => item.replace(/\[[^\]]+\]/, trader.join(", ")).replace(/\s+,$/, ","));
  return [{ p: segments[0] }, { ul: items }, ...(note ? [{ p: `(*) ${note}` }] : [])];
}

/** The page's sections in its language: the model's, with tokens filled; the code's (the model form); and Sources. */
export function renderLegalPage(input: {
  plan: LegalPlan;
  sections: readonly DraftSection[];
  sheet: FactSheet;
  /** The model withdrawal form as the starter has it (nb, or where the annex cannot be read). */
  starterForm: RenderedSection | null;
  writtenAt: Date;
  /** The page is in English for a store whose main language is none of the four. */
  english?: boolean;
}): { sections: RenderedSection[]; missing: string[]; cited: CitedPassage[] } {
  const { plan, sheet } = input;
  const language = plan.language;
  const missing = new Set<string>();
  const cited = new Map<string, CitedPassage>();
  const out: RenderedSection[] = [];
  for (const planned of plan.sections) {
    const drafted = input.sections.find((s) => s.topic === planned.topic);
    if (!drafted) continue;
    const blocks: RenderedBlock[] = [];
    for (const b of drafted.blocks) {
      for (const c of b.cites ?? []) cited.set(passageKey(c.source, c.passage), { source: c.source, passage: c.passage });
      if (b.kind === "list") {
        blocks.push({ ul: b.items.map((i) => fillTokens(i, sheet, language, missing)) });
        continue;
      }
      const list = /^\{(list:[a-z_.]+)\}$/.exec(b.text.trim());
      if (list) {
        const items = sheet.lists[list[1]] ?? [];
        if (items.length > 0) blocks.push({ ul: [...items] });
        continue;
      }
      const text = fillTokens(b.text, sheet, language, missing).trim();
      if (text) blocks.push({ p: text });
    }
    out.push({ topic: planned.topic, heading: planned.heading, blocks });
  }
  for (const topic of plan.codeTopics) {
    if (topic !== "model_form") continue;
    const annex = plan.offered.get(passageKey("eu-crd", "anx_I"));
    const note = plan.offered.get(passageKey("eu-crd", "fn_star1"));
    const fromAnnex = language !== "nb" && annex && annex.language === language ? annexForm(annex.text, note && note.language === language ? note.text : null, sheet) : null;
    const heading = STARTER_TEXTS[language].m[`h.${plan.role}.${topic}`] ?? topic;
    if (fromAnnex) {
      cited.set(passageKey("eu-crd", "anx_I"), { source: "eu-crd", passage: "anx_I" });
      if (note) cited.set(passageKey("eu-crd", "fn_star1"), { source: "eu-crd", passage: "fn_star1" });
      out.push({ topic, heading, blocks: fromAnnex });
    } else if (input.starterForm) {
      out.push({ ...input.starterForm, heading });
    }
  }
  const w = LEGAL_AI_WORDS[language];
  const sourceLines = [...cited.values()]
    .map((c) => ({ c, o: plan.offered.get(passageKey(c.source, c.passage)) }))
    .filter((x): x is { c: CitedPassage; o: Offered } => Boolean(x.o))
    .sort((a, b) => a.c.source.localeCompare(b.c.source) || a.c.passage.localeCompare(b.c.passage, undefined, { numeric: true }))
    .map(({ c, o }) => {
      const source = LEGAL_SOURCES_BY_KEY[c.source];
      return `${source.title}, ${o.title} (${w.read.replace("{date}", dateIn(o.readAt, language))}): [${source.url}](${source.url})`;
    });
  out.push({
    topic: "sources",
    heading: w.sources,
    blocks: [{ p: w.prepared.replace("{date}", dateIn(input.writtenAt, language)) }, ...(input.english ? [{ p: w.englishPage }] : []), ...(sourceLines.length > 0 ? [{ ul: sourceLines }] : [])],
  });
  return { sections: out, missing: [...missing], cited: [...cited.values()] };
}

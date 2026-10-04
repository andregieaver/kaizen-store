/**
 * Legal starter pages (wave 1, 1e, `docs/wave-1-trust.md` 2.1, 4.1): terms of sale, privacy statement, returns policy,
 * shipping policy, withdrawal information (with the model withdrawal form) and imprint, in Norwegian, Swedish, Danish and
 * English, filled from the store's own facts (`LegalFacts`) and made as rows of rich text for the page builder.
 *
 * Nothing here is legal advice and no sentence was written by a model. The words are hand-written, in
 * `src/lib/legal-starters/{nb,sv,da,en}.ts`, as tables of sentences with `{name}` holes: a person reading a table reads
 * everything a store will be told. The SHAPE (which sections, in what order, which sentence for which fact) is here, in
 * one place, so the four languages cannot drift apart: a language only supplies words. A fact the store does not hold
 * becomes a visible `[[Add: …]]` placeholder, never an invented sentence; a thing for a lawyer to check is `[[Check: …]]`.
 * The first row of every page is the draft notice (class `legal-review-notice`), and the builder's checker blocks
 * publishing over it and over any placeholder until the owner has dealt with them.
 *
 * Every text needs review by a person before real use (`LEGAL_REVIEW_MANIFEST`, `docs/wave-1-trust.md` section 8).
 */
import { formatMoney } from "./money";
import type { LegalFacts } from "./legal-facts";
import { isLegalRole, type LegalRole } from "./legal-roles";
import { isLinkAddress, type BlockNode, type InlineNode, type PageBlock, type PageRow, type RichTextDoc } from "./page-content";
import { LEGAL_NOTICE_CLASS } from "./page-a11y";
import type { NewId } from "./page-rows";
import { EN } from "./legal-starters/en";
import { NB } from "./legal-starters/nb";
import { SV } from "./legal-starters/sv";
import { DA } from "./legal-starters/da";

/** The six kinds of page a starter is made for; the accessibility statement has its own builder (`a11y-statement.ts`). */
export const STARTER_ROLES = ["terms", "privacy", "returns_policy", "shipping_policy", "withdrawal_info", "imprint"] as const satisfies readonly LegalRole[];
export type StarterRole = (typeof STARTER_ROLES)[number];
export const isStarterRole = (value: unknown): value is StarterRole => (STARTER_ROLES as readonly unknown[]).includes(value);

export const STARTER_LANGUAGES = ["nb", "sv", "da", "en"] as const;
export type StarterLanguage = (typeof STARTER_LANGUAGES)[number];

/** One language's words: a table of sentences by key. */
export type StarterText = { language: StarterLanguage; locale: string; m: Record<string, string> };

export const STARTER_TEXTS: Record<StarterLanguage, StarterText> = { nb: NB, sv: SV, da: DA, en: EN };

/** The language a store's starter is written in: its main language when it is one of the four, else null (English with an extended notice). */
export function starterLanguageOf(locale: string | null | undefined): StarterLanguage | null {
  const base = (locale ?? "").toLowerCase().split(/[-_]/)[0];
  if (base === "nb" || base === "no" || base === "nn") return "nb";
  if (base === "sv" || base === "da" || base === "en") return base;
  return null;
}

// ---------------------------------------------------------------------------
// What each kind must hold
// ---------------------------------------------------------------------------

/** The topics each starter must carry (checked in all four languages by a test). Conditional ones are in `CONDITIONAL_TOPICS`. */
export const REQUIRED_TOPICS: Record<StarterRole, readonly string[]> = {
  terms: ["seller", "products_prices", "vat_shipping_costs", "order_contract", "payment", "delivery", "withdrawal", "returns_link", "conformity", "complaints", "disputes", "privacy_link", "law_and_changes"],
  privacy: ["controller", "contact", "purposes_basis", "recipients", "transfers", "retention", "rights", "consent_withdrawal", "complaint_authority", "obligation_to_provide", "automated_decisions", "cookies_link"],
  returns_policy: ["window", "how_to", "who_pays", "refund_timing", "excluded_goods", "return_address", "withdrawal_link"],
  shipping_policy: ["markets", "rates", "carriers", "delivery_time", "tracking", "outside_eu", "damaged_goods", "contact"],
  withdrawal_info: ["right", "how", "effects", "exclusions", "model_form"],
  imprint: ["legal_name", "org_number", "vat_number", "address", "email", "phone", "register", "supervisory_authority"],
};

/** Topics that are there only when the store's facts call for them. */
export const CONDITIONAL_TOPICS: Record<StarterRole, Record<string, (f: LegalFacts) => boolean>> = {
  terms: {
    bookings_subscriptions: (f) => f.bookingsOn || f.deliveriesOn,
    businesses: (f) => f.audience !== "consumers",
  },
  privacy: {},
  returns_policy: { businesses: (f) => f.audience !== "consumers" },
  shipping_policy: {},
  withdrawal_info: {},
  imprint: {},
};

// ---------------------------------------------------------------------------
// The shape: sections of blocks, each block a sentence key and what fills its holes
// ---------------------------------------------------------------------------

type Args = Record<string, string>;
type Para = { p: string; args?: Args };
type Items = { ul: { key: string; args?: Args }[] };
type ShapeBlock = Para | Items;
type Shape = { topic: string; blocks: ShapeBlock[] };

/** What the shape needs from a language and a store to turn facts into words. */
type Helpers = {
  /** A fact, or its placeholder `[[Add: label]]` when the store has none. */
  value(fact: string | null | undefined, label: string): string;
  add(label: string): string;
  check(label: string): string;
  money(minor: number, currency: string): string;
  country(code: string): string;
  list(items: readonly string[]): string;
};

const p = (key: string, args?: Args): Para => ({ p: key, ...(args && { args }) });
const ul = (...items: ({ key: string; args?: Args } | false | null | undefined)[]): Items => ({ ul: items.filter((i): i is { key: string; args?: Args } => Boolean(i)) });
const item = (key: string, args?: Args) => ({ key, ...(args && { args }) });

const EXCLUSIONS = ["custom_made", "perishable", "sealed_hygiene", "sealed_media", "mixed", "price_fluctuation", "alcohol", "periodicals", "digital"] as const;
/** CRD Art. 16(a) and (l): what a store with bookings (appointments, stays, rentals) also has to name. */
const SERVICE_EXCLUSIONS = ["dated_service", "service_performed"] as const;

/** The exclusions a page lists: the goods ones always (a store does not tell us what it sells; a check line asks it to delete the rest), the services ones where bookings are on. */
const exclusionItems = (f: LegalFacts) => [...EXCLUSIONS, ...(f.bookingsOn ? SERVICE_EXCLUSIONS : [])].map((e) => item(`excl.${e}`));

/** One line for each market's shipping rate, shared by the terms and the shipping policy. */
function rateItems(f: LegalFacts, h: Helpers) {
  return f.shipping.map((s) => {
    const country = h.country(s.code);
    if (s.rateMinor === null) return item("rate.none", { country, check: h.add("shippingPrice") });
    if (s.rateMinor === 0) return item("rate.zero", { country });
    const rate = h.money(s.rateMinor, s.currency);
    return s.freeAboveMinor !== null ? item("rate.free", { country, rate, amount: h.money(s.freeAboveMinor, s.currency) }) : item("rate.plain", { country, rate });
  });
}

function shapeOf(role: StarterRole, f: LegalFacts, h: Helpers): Shape[] {
  const store = h.value(f.storeName, "storeName");
  const name = h.value(f.legalName, "legalName");
  const org = h.value(f.organisationNumber, "orgNumber");
  const address = h.value(f.address, "address");
  const email = h.value(f.email, "email");
  const phone = h.value(f.phone, "phone");
  const countryName = f.country ? h.country(f.country) : h.add("country");
  const marketNames = f.markets.length > 0 ? h.list(f.markets.map((m) => h.country(m.code))) : h.add("markets");
  const vat = f.vat.registered === false ? p("vat.no") : p("vat.yes", { vat: h.value(f.vat.number, "vatNumber") });
  const carriers = f.carriers.length > 0 ? p("carriers.some", { carriers: h.list(f.carriers) }) : p("carriers.none", { check: h.add("carriers") });
  const withdrawLink = (yes: string, no: string) => (f.links.withdraw ? p(yes, { href: f.links.withdraw }) : p(no));
  const rates = rateItems(f, h);
  const days = String(f.returns.windowDays);
  const businesses = f.audience !== "consumers";

  switch (role) {
    case "terms":
      return [
        { topic: "seller", blocks: [p("terms.seller.1", { store, name, org }), vat, p("terms.seller.2", { address, email, phone })] },
        { topic: "products_prices", blocks: [p("terms.products.1"), p("terms.products.2", { currencies: f.markets.length > 0 ? h.list([...new Set(f.markets.map((m) => m.currency))]) : h.add("currency") })] },
        { topic: "vat_shipping_costs", blocks: [p("terms.costs.1"), rates.length > 0 ? ul(...rates) : p("terms.costs.none", { check: h.add("shippingPrice") })] },
        { topic: "order_contract", blocks: [p("terms.order.1"), p("terms.order.2", { check: h.check("contractFormation") }), p("terms.order.3")] },
        { topic: "payment", blocks: [p("terms.payment.1")] },
        { topic: "delivery", blocks: [p("terms.delivery.1", { markets: marketNames }), p("terms.delivery.2", { check: h.add("deliveryTime") }), carriers] },
        {
          topic: "withdrawal",
          // The 14 days run from receipt for goods only (CRD Art. 9(2)): services from the contract, regular delivery from the first one.
          blocks: [p("terms.withdrawal.1"), ...(f.bookingsOn ? [p("terms.withdrawal.services")] : []), ...(f.deliveriesOn ? [p("terms.withdrawal.regular")] : []), withdrawLink("terms.withdrawal.link", "terms.withdrawal.nolink")],
        },
        { topic: "returns_link", blocks: [p("terms.returns.1", { days }), p(f.returns.whoPays === "store" ? "terms.returns.store" : "terms.returns.shopper")] },
        { topic: "conformity", blocks: [p("terms.conformity.1"), p("terms.conformity.2", { check: h.add("guaranteePeriod") })] },
        { topic: "complaints", blocks: [p("terms.complaints.1", { email }), p("terms.complaints.2", { check: h.check("complaintBody") })] },
        { topic: "disputes", blocks: [p("terms.disputes.1", { check: h.check("complaintBody") })] },
        { topic: "privacy_link", blocks: [p("terms.privacy.1")] },
        ...(f.bookingsOn || f.deliveriesOn
          ? [{ topic: "bookings_subscriptions", blocks: [...(f.bookingsOn ? [p("terms.bookings.1")] : []), ...(f.deliveriesOn ? [p("terms.bookings.2")] : [])] }]
          : []),
        ...(businesses ? [{ topic: "businesses", blocks: [p("terms.business.1"), p(f.returns.b2bReturns ? "terms.business.returns" : "terms.business.noreturns")] }] : []),
        { topic: "law_and_changes", blocks: [p("terms.law.1", { country: countryName }), p("terms.law.2", { check: h.check("legalReferences") }), p("terms.law.3")] },
      ];
    case "privacy":
      return [
        { topic: "controller", blocks: [p("privacy.controller.1", { store, name, org, address }), p("privacy.controller.2")] },
        { topic: "contact", blocks: [p("privacy.contact.1", { email, phone })] },
        {
          topic: "purposes_basis",
          blocks: [
            p("privacy.purposes.1"),
            ul(item("privacy.purpose.orders"), item("privacy.purpose.accounting"), item("privacy.purpose.service"), item("privacy.purpose.security"), item("privacy.purpose.marketing"), f.visitCounting && item("privacy.purpose.visits")),
          ],
        },
        {
          topic: "recipients",
          blocks: [
            p("privacy.recipients.1"),
            ul(
              item("privacy.recipient.platform"),
              item("privacy.recipient.stripe"),
              item("privacy.recipient.email"),
              f.carriers.length > 0 ? item("privacy.recipient.carriers", { carriers: h.list(f.carriers) }) : item("privacy.recipient.carriers.none", { check: h.add("carriers") }),
              ...f.trackingTools.map((tool) => item("privacy.recipient.tool", { tool })),
              item("privacy.recipient.authorities"),
            ),
          ],
        },
        { topic: "transfers", blocks: [p("privacy.transfers.1"), p("privacy.transfers.2", { check: h.check("transfers") })] },
        { topic: "retention", blocks: [p("privacy.retention.1", { check: h.add("retentionPeriod") }), p("privacy.retention.2")] },
        {
          topic: "rights",
          blocks: [
            p("privacy.rights.1"),
            ul(item("privacy.right.access"), item("privacy.right.rectify"), item("privacy.right.erase"), item("privacy.right.restrict"), item("privacy.right.portability"), item("privacy.right.object")),
          ],
        },
        { topic: "consent_withdrawal", blocks: [p("privacy.consent.1")] },
        { topic: "complaint_authority", blocks: [p("privacy.complaint.1", { check: h.check("dataAuthority") })] },
        { topic: "obligation_to_provide", blocks: [p("privacy.obligation.1")] },
        { topic: "automated_decisions", blocks: [p("privacy.automated.1"), ...(f.chatAgent ? [p("privacy.automated.chat", { check: h.add("aiProvider") })] : [])] },
        { topic: "cookies_link", blocks: [f.links.cookies ? p("privacy.cookies.link", { href: f.links.cookies }) : p("privacy.cookies.nolink")] },
      ];
    case "returns_policy":
      return [
        { topic: "window", blocks: [p("returns.window.1", { days }), ...(f.returns.windowDays > 14 ? [p("returns.window.extended", { days })] : [])] },
        {
          topic: "how_to",
          blocks: [
            p("returns.how.1"),
            f.returns.instructions ? p("returns.how.instructions", { instructions: f.returns.instructions }) : p("returns.how.noinstructions", { check: h.add("returnInstructions") }),
          ],
        },
        { topic: "who_pays", blocks: [p(f.returns.whoPays === "store" ? "returns.pays.store" : "returns.pays.shopper")] },
        { topic: "refund_timing", blocks: [p(f.returns.refundWhen === "request" ? "returns.refund.request" : "returns.refund.received")] },
        {
          topic: "excluded_goods",
          blocks: [p("returns.excluded.1"), ul(...exclusionItems(f)), p("excl.check", { check: h.check("exclusionsFit") }), p(f.returns.acceptExcluded ? "returns.excluded.accept" : "returns.excluded.refuse")],
        },
        { topic: "return_address", blocks: [p("returns.address.1", { address: h.value(f.returns.address, "returnAddress") })] },
        { topic: "withdrawal_link", blocks: [withdrawLink("returns.withdrawal.link", "returns.withdrawal.nolink")] },
        ...(businesses ? [{ topic: "businesses", blocks: [p("returns.business.1"), p(f.returns.b2bReturns ? "returns.business.voluntary" : "returns.business.none")] }] : []),
      ];
    case "shipping_policy":
      return [
        { topic: "markets", blocks: [p("shipping.markets.1", { markets: marketNames })] },
        { topic: "rates", blocks: [p("shipping.rates.1"), rates.length > 0 ? ul(...rates) : p("shipping.rates.none", { check: h.add("shippingPrice") })] },
        { topic: "carriers", blocks: [carriers] },
        { topic: "delivery_time", blocks: [p("shipping.time.1", { check: h.add("deliveryTime") })] },
        { topic: "tracking", blocks: [p("shipping.tracking.1")] },
        { topic: "outside_eu", blocks: [p("shipping.outside.1", { check: h.add("outsideEu") })] },
        { topic: "damaged_goods", blocks: [p("shipping.damaged.1", { check: h.add("damagedDays") })] },
        { topic: "contact", blocks: [p("shipping.contact.1", { email })] },
      ];
    case "withdrawal_info":
      return [
        { topic: "right", blocks: [p("withdrawal.right.1"), p("withdrawal.right.2"), ...(f.bookingsOn ? [p("withdrawal.right.services")] : []), ...(f.deliveriesOn ? [p("withdrawal.right.regular")] : [])] },
        { topic: "how", blocks: [p("withdrawal.how.1", { name, address, email }), withdrawLink("withdrawal.how.online", "withdrawal.how.noonline"), p("withdrawal.how.2")] },
        {
          topic: "effects",
          blocks: [p("withdrawal.effects.1"), p("withdrawal.effects.2"), p("withdrawal.effects.3"), p(f.returns.whoPays === "store" ? "withdrawal.effects.pays.store" : "withdrawal.effects.pays.shopper"), p("withdrawal.effects.4"), ...(f.bookingsOn ? [p("withdrawal.effects.services")] : [])],
        },
        { topic: "exclusions", blocks: [p("withdrawal.excl.1"), ul(...exclusionItems(f)), p("excl.check", { check: h.check("exclusionsFit") })] },
        {
          topic: "model_form",
          blocks: [
            p("withdrawal.form.1"),
            ul(
              item("withdrawal.form.to", { name, address, email }),
              item("withdrawal.form.notice"),
              item("withdrawal.form.ordered"),
              item("withdrawal.form.consumer"),
              item("withdrawal.form.address"),
              item("withdrawal.form.signature"),
              item("withdrawal.form.date"),
            ),
            p("withdrawal.form.note"),
          ],
        },
      ];
    case "imprint":
      return [
        { topic: "legal_name", blocks: [p("imprint.legal_name", { name, store })] },
        { topic: "org_number", blocks: [p("imprint.org_number", { org })] },
        { topic: "vat_number", blocks: [f.vat.registered === false ? p("imprint.vat.no") : p("imprint.vat.yes", { vat: h.value(f.vat.number, "vatNumber") })] },
        { topic: "address", blocks: [p("imprint.address", { address })] },
        { topic: "email", blocks: [p("imprint.email", { email })] },
        { topic: "phone", blocks: [p("imprint.phone", { phone })] },
        { topic: "register", blocks: [p("imprint.register", { check: h.check("tradeRegister") })] },
        { topic: "supervisory_authority", blocks: [p("imprint.supervisory", { check: h.check("supervisoryAuthority") })] },
      ];
  }
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** A user's own text can hold square brackets; they must not make a link or a placeholder of themselves. */
const defang = (text: string) => text.replace(/\[/g, "(").replace(/\]/g, ")");

function helpersFor(text: StarterText, markets: readonly { code: string }[] = []): Helpers {
  const m = text.m;
  const prefix = (key: "ph.add" | "ph.check", label: string) => `[[${m[key]}: ${m[`label.${label}`] ?? label}]]`;
  let regions: Intl.DisplayNames | null = null;
  try {
    regions = new Intl.DisplayNames([text.locale], { type: "region" });
  } catch {
    regions = null;
  }
  void markets;
  return {
    value: (fact, label) => (fact && fact.trim() !== "" ? defang(fact) : prefix("ph.add", label)),
    add: (label) => prefix("ph.add", label),
    check: (label) => prefix("ph.check", label),
    money: (minor, currency) => formatMoney(minor, currency, text.locale),
    country: (code) => regions?.of(code) ?? code,
    list: (items) => {
      try {
        return new Intl.ListFormat(text.locale, { style: "long", type: "conjunction" }).format(items);
      } catch {
        return items.join(", ");
      }
    },
  };
}

/** A sentence with its holes filled: `{name}` is replaced by what it names; a hole with no value is left as it is, for a test to find. */
export function fill(template: string, args: Args = {}): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, key: string) => (key in args ? args[key] : whole));
}

export type RenderedBlock = { p: string } | { ul: string[] };
export type RenderedSection = { topic: string; heading: string; blocks: RenderedBlock[] };

/** The sections of a starter in a language, with their words. Throws for a key the language lacks: a test holds the tables to the shape. */
export function legalStarterSections(role: StarterRole, language: StarterLanguage, facts: LegalFacts): RenderedSection[] {
  const text = STARTER_TEXTS[language];
  const h = helpersFor(text);
  const say = (key: string, args?: Args) => {
    const template = text.m[key];
    if (template === undefined) throw new Error(`legal starter text "${key}" is missing in ${language}`);
    return fill(template, args);
  };
  return shapeOf(role, facts, h).map((section) => ({
    topic: section.topic,
    heading: say(`h.${role}.${section.topic}`),
    blocks: section.blocks.map((block) => ("p" in block ? { p: say(block.p, block.args) } : { ul: block.ul.map((i) => say(i.key, i.args)) })),
  }));
}

/** The keys a role and facts use, for the tests that hold every language to the shape. */
export function starterKeys(role: StarterRole, facts: LegalFacts): string[] {
  const keys = new Set<string>();
  const h = helpersFor(EN);
  for (const section of shapeOf(role, facts, h)) {
    keys.add(`h.${role}.${section.topic}`);
    for (const block of section.blocks) {
      if ("p" in block) keys.add(block.p);
      else for (const i of block.ul) keys.add(i.key);
    }
  }
  return [...keys];
}

/** What the page is called and its address, in the language. */
export const starterTitle = (role: StarterRole, language: StarterLanguage): string => STARTER_TEXTS[language].m[`title.${role}`];
export const starterSlug = (role: StarterRole, language: StarterLanguage): string => STARTER_TEXTS[language].m[`slug.${role}`];

/** The notice every starter opens with; for a main language outside the four, English with the sentence that says so. */
export function reviewNotice(language: StarterLanguage, options: { translated?: boolean } = {}): string {
  const m = STARTER_TEXTS[language].m;
  return options.translated ? `${m.notice} ${m["notice.language"]}` : m.notice;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const LINK = /\[([^[\]]+)\]\(([^()\s]+)\)/g;

/** A sentence as rich text, `[text](address)` as a link when the address is one the site allows. */
function inline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const [whole, label, href] = match;
    const at = match.index ?? 0;
    if (at > last) nodes.push({ type: "text", text: text.slice(last, at) });
    nodes.push(isLinkAddress(href) ? { type: "text", text: label, marks: [{ type: "link", attrs: { href } }] } : { type: "text", text: label });
    last = at + whole.length;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes.length > 0 ? nodes : [{ type: "text", text }];
}

const paragraph = (text: string): BlockNode => ({ type: "paragraph", content: inline(text) });

function doc(blocks: RenderedBlock[]): RichTextDoc {
  const content: BlockNode[] = blocks.map((block): BlockNode =>
    "p" in block ? paragraph(block.p) : { type: "bulletList", content: block.ul.map((line) => ({ type: "listItem" as const, content: [paragraph(line)] })) },
  );
  return { type: "doc", content };
}

export type StarterPage = { title: string; slug: string; rows: PageRow[]; language: StarterLanguage };

/**
 * The rows of a draft page made of sections: the draft notice first, in a row of its own, then the title and each section as
 * a heading (with an address of its own, `t-{topic}`) and its text. Shared by the starters and the accessibility statement.
 */
export function draftRows(title: string, notice: string, sections: readonly RenderedSection[], id: NewId): PageRow[] {
  const noticeBlock: PageBlock = { id: id(), type: "richText", className: LEGAL_NOTICE_CLASS, doc: doc([{ p: notice }]) };
  const blocks: PageBlock[] = [{ id: id(), type: "heading", level: 1, text: title }];
  for (const section of sections) {
    blocks.push({ id: id(), type: "heading", level: 2, text: section.heading, htmlId: `t-${section.topic}` });
    blocks.push({ id: id(), type: "richText", doc: doc(section.blocks) });
  }
  const row = (inside: PageBlock[]): PageRow => ({ id: id(), type: "row", layout: "1", columns: [{ id: id(), blocks: inside }] });
  return [row([noticeBlock]), row(blocks)];
}

/**
 * A starter as the rows of a page. `id` makes block ids (give the same generator state to each language of one page, and the
 * blocks are the same in all of them: the page's translations are then written against the same ids). `translatedNotice`: the
 * page is made in English for a store whose main language is none of the four.
 */
export function legalStarter(role: StarterRole, language: StarterLanguage, facts: LegalFacts, id: NewId, options: { translatedNotice?: boolean } = {}): StarterPage {
  const sections = legalStarterSections(role, language, facts);
  const title = starterTitle(role, language);
  return { title, slug: starterSlug(role, language), language, rows: draftRows(title, reviewNotice(language, { translated: options.translatedNotice }), sections, id) };
}

/** The page's role from a string, for the server's input checks. */
export const starterRoleOf = (value: unknown): StarterRole | null => (isLegalRole(value) && isStarterRole(value) ? value : null);

// ---------------------------------------------------------------------------
// What needs a person to read it
// ---------------------------------------------------------------------------

/**
 * Every text this module makes, for the list of what needs human legal review (`docs/wave-1-trust.md` section 8): a test
 * holds this equal to the files in `src/lib/legal-starters/`, so the list cannot go stale.
 */
export const LEGAL_REVIEW_MANIFEST = {
  files: ["src/lib/legal-starters/nb.ts", "src/lib/legal-starters/sv.ts", "src/lib/legal-starters/da.ts", "src/lib/legal-starters/en.ts"],
  kinds: [...STARTER_ROLES, "review notice"],
  languages: [...STARTER_LANGUAGES],
} as const;

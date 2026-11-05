// The Languages and Currencies page (`/languages-and-currencies`), made again on 5 November 2026 to show what Kaizena Flow does for a store
// that sells across borders, in the shape of the feature pages the owner published that day (docs/site-design.md 6.11). Every line is
// something built; its source is beside it (docs/rules/storefront.md, docs/rules/admin/commerce.md, the decisions, production's own
// tables on 5 November: 27 languages in `platform_languages`, 28 countries, the EU's and Norway). Checked by `checkPage()` (parts.ts).
//
// Words held back on purpose: the shop's own interface text (buttons, checkout, emails) is hand-written in Norwegian, Swedish, Danish and
// English only, and `ui_translations` was empty in production on 5 November, so every other language shows it in English until a platform
// admin presses Translate and review at Platform → Languages (docs/rules/storefront.md, Interface text). The page says "27 languages" of the owner's own words (products,
// pages, menus) and says which four the shop itself comes in. Vipps (through Mollie, live payments not yet open) is not named.
import { expect, it } from "vitest";

import { TURN_A, TURN_B, cardsRow, checkPage, endRow, featureRow, hero, highlightRow, questionsRow, card } from "./parts";

const faq: { q: string; bold: string; rest: string }[] = [
  // commerce.countries: the EU's 27 and Norway; a market brings its currency, VAT (commerce.vat_rate) and default language.
  {
    q: "Which countries can I sell to?",
    bold: "Every EU country and Norway.",
    rest: "Add the countries you want. Each comes with its own currency, VAT and language, and you change what you like.",
  },
  // platform_languages (27); interface text hand-written in nb, sv, da and en (src/lib/messages/), the rest English until translated.
  {
    q: "Which languages can my shop speak?",
    bold: "Your own words in any of 27 European languages.",
    rest: "Products, pages and menus can be in any of them. The shop's buttons, checkout and emails come ready in Norwegian, Swedish, Danish and English.",
  },
  // D109: one store, markets per country; language and currency apart from the country.
  {
    q: "Do I need a store for each country?",
    bold: "No.",
    rest: "One store sells to all your countries, each with its own currency, prices, VAT and language, from the same admin.",
  },
  // D161: the owner's data for their accountant, never a tax return or a filing.
  {
    q: "Does Flow file my VAT returns?",
    bold: "No, but it gets you ready.",
    rest: "Flow charges the right VAT on every order and gives you the VAT, OSS and IOSS figures. You or your accountant file the return.",
  },
  // D335 A2: a price typed by hand is fixed and never touched; an empty one follows the rule.
  {
    q: "Can I set my own price in each country?",
    bold: "Yes.",
    rest: "Type a price for any country, or let a rule work it out from another country's price. A price you type yourself is never changed by the rule.",
  },
  // D343: DAP by default, DDP collects at checkout from an estimate; no estimate, no DDP.
  {
    q: "Who pays duties when I ship outside the EU?",
    bold: "You choose, country by country.",
    rest: "The buyer pays on delivery, or you collect duties and import VAT at checkout from an estimate shown before they pay.",
  },
];

function languagesPage() {
  const rows = [
    hero({
      eyebrow: "Languages and Currencies",
      title: "Sell Across Europe From One Store",
      bold: "One store, many countries.",
      rest: "Each country gets its own language, currency, prices, VAT and ways to pay, all run from the same admin.",
      anchor: { text: "See how it works", href: "#international" },
      claims: ["Every EU country and Norway", "Local currencies", "The buyer's own VAT"],
    }),
    // A market per country (D109), with its currency and VAT; payment methods per country (D291, PAYMENT_METHODS).
    cardsRow({
      htmlId: "international", eyebrow: "One store", title: "Every market, its own way", tone: "light-color", background: TURN_A,
      bold: "Add a country in a few presses.", rest: "Its currency, VAT and language come with it, and you decide what changes from there.",
      cards: [
        card("Speak", "their language", "Your products and pages in 27 European languages.", "Translated with AI, checked by you.", ["One language per country, or several", "The whole store translated at once", "Texts for one country only"]),
        card("Show", "their prices", "Shoppers choose their currency.", "Rates follow the European Central Bank every day.", ["Prices rounded the way you like", "Or your own price per country", "Free shipping limits converted too"]),
        card("Take", "their payments", "The ways each country likes to pay.", "Cards, Apple Pay and Google Pay everywhere, and local favourites.", ["Klarna and MobilePay", "iDEAL, Bancontact, EPS, Przelewy24 and BLIK", "SEPA Direct Debit"]),
      ],
    }),
    // Languages: content in any platform language (platform_languages), Translate the store (D110: suggestions ticked by a person, legal
    // texts unticked), Translate with AI in the builder, language apart from country (D109), language and country domains (D338), hreflang
    // and the sitemap per language and country (D338).
    featureRow({
      eyebrow: "Languages", title: "Speak to every shopper in their language", tone: "dark-color", background: TURN_B,
      bold: "Write once, and let AI translate the rest.", rest: "Every suggestion waits for you to read and tick it before it is saved.",
      lines: [
        "Products, pages, menus and articles in any of 27 European languages",
        "The whole store translated in one go, or one page from the builder",
        "Legal pages left unticked, so a person reads them first",
        "Shoppers choose their language, whichever country they buy in",
        "A domain of its own for a language or a country",
        "Search engines shown the right page for each language and country",
      ],
    }),
    // Currencies: store_currencies with rates_auto (refreshAutoRates() daily, ECB), ROUND_STEPS, market price rules (D335 A2: base,
    // percentage, rounding, ending; typed prices fixed), amounts stored in the country's own currency and converted when read (D109).
    featureRow({
      eyebrow: "Currencies", title: "Prices that feel at home", tone: "light-color", background: TURN_A, listFirst: true,
      bold: "Show every price in the shopper's own currency,", rest: "or set prices per country that follow a rule you choose.",
      lines: [
        "Shoppers choose from the currencies you offer",
        "Rates from the European Central Bank, updated every day",
        "Converted prices rounded to the step you choose",
        "Prices per country by rule, such as 10 % above another country and ending in 9",
        "A price you type yourself always stays as you set it",
        "Discounts and free shipping limits converted for every currency",
      ],
    }),
    // VAT: vat_rate(country, category) with reduced rates kept by the platform with dates (D157, set_vat_rate, syncStandardRates), OSS and
    // IOSS reports (D161), VIES before the reverse charge (D157), invoices and credit notes (D159), order numbers without gaps (D141),
    // business buyers' prices without VAT (withoutVat()).
    featureRow({
      eyebrow: "VAT", title: "The right VAT in every country", tone: "dark-color", background: TURN_B,
      bold: "Flow charges the VAT of the buyer's country,", rest: "keeps the rates up to date and has the figures ready for your accountant.",
      lines: [
        "Each country's VAT rates, reduced ones included, kept up to date by us",
        "OSS and IOSS figures, ready for your accountant",
        "A business buyer's VAT number checked with the EU's VIES before VAT is left off",
        "Business buyers see their prices without VAT",
        "Legal invoices and credit notes, with the VAT shown in your own currency too",
        "Order numbers without gaps, as some countries require",
      ],
    }),
    // EU rules: withdrawal (D153), the 30-day reference price (<Price>, prior_30d_minor), unit price (D160), GPSR safety details, terms
    // at checkout with the record kept (D158), legal starters in nb, sv, da and en (D158, hand-written, for the owner to complete).
    featureRow({
      eyebrow: "EU rules", title: "Selling in the EU, built in", tone: "light-color", background: TURN_A, listFirst: true,
      bold: "The rules that protect shoppers in Europe", rest: "are part of Flow, so there is no app to find for each one.",
      lines: [
        "A withdrawal button with the 14-day clock and its exclusions",
        "The 30-day reference price, shown only on a real reduction",
        "The price per kilo or litre beside the price",
        "Product safety details on the product page",
        "Terms accepted at checkout, with a record of what the buyer saw",
        "Legal page starters in Norwegian, Swedish, Danish and English",
      ],
    }),
    // Shipping and customs: flat rates per market with free shipping above a value (commerce.shipping_rates), carriers (D134 to D138,
    // D458, D459), customs and duties (D343: HS codes, DAP or DDP, VOEC and IOSS, Bring's customs declaration).
    featureRow({
      eyebrow: "Across borders", title: "Shipping and customs, sorted", tone: "dark-color", background: TURN_B,
      bold: "Ship between the Nordics and the EU", rest: "with labels, customs details and an estimate of the duties made for you.",
      lines: [
        "Shipping rates per country, free above an amount you choose",
        "Labels and pickup points with Bring, PostNord, DHL, UPS and more",
        "Duties and import VAT estimated from each product's customs code",
        "The buyer pays duties on delivery, or you collect them at checkout",
        "VAT collected at checkout under Norway's VOEC or the EU's IOSS",
        "Customs details sent with your Bring parcels",
      ],
    }),
    // Each country's own (D338: pages and menu labels per country, a product's text per country, the country suggestion), what is sold
    // where (D335 A1), producer responsibility (D342: no sale where the store is not registered).
    featureRow({
      eyebrow: "Country by country", title: "Each country gets its own", tone: "light-color", background: TURN_A, listFirst: true,
      bold: "Decide what each country sees,", rest: "from the products on sale to the words on the page.",
      lines: [
        "A product switched off in one country, and kept on sale elsewhere",
        "A product description written for one country",
        "Pages and menu labels for chosen countries only",
        "Visitors offered their own country's shop, never moved without asking",
        "Producer registrations per country, so nothing is sold where you are not registered",
      ],
    }),
    // The AI manager's setup tools (set_countries, set_languages, set_currencies; gated once the store is open), B2B across borders
    // (D157 reverse charge, D108, D293), data in Dublin (Supabase eu-west-1, Vercel dub1).
    highlightRow([
      {
        eyebrow: "AI Store Manager", title: "Ask it to add a country",
        bold: "Tell it the countries, languages and currencies you want,", rest: "and it sets them up, waiting for your yes once your store is open.",
        link: { text: "AI Store Manager", href: "/store-manager" },
      },
      {
        eyebrow: "B2B", title: "Sell to businesses abroad",
        bold: "Company accounts, price lists and payment terms,", rest: "with the reverse charge applied when a business gives a valid VAT number.",
        link: { text: "B2B and B2C", href: "/b2b-b2c" },
      },
      {
        eyebrow: "Data", title: "Kept in Europe",
        bold: "Your store's database and servers are in Dublin,", rest: "inside the EU, wherever your customers are.",
      },
    ]),
    questionsRow(faq),
    endRow({
      eyebrow: "Ready?", title: "Take your store across borders",
      bold: "Start with one country, and add the next when you are ready.", rest: "Everything stays in one admin.",
    }),
  ];
  return {
    title: "Languages and Currencies",
    slug: "languages-and-currencies",
    seo: {
      title: "Sell across Europe: languages and VAT | Kaizena Flow",
      description: "Sell to every EU country and Norway from one store: products in 27 languages, local currencies and payments, the buyer's VAT, OSS figures and customs.",
    },
    rows,
    tags: [],
    categories: [],
    thumbnail: null,
    aiAssistants: true,
    searchEngines: true,
  };
}

it("builds the Languages and Currencies page as the editor would save it", () => {
  const checked = checkPage("languages-and-currencies", languagesPage());
  expect(checked.errors).toEqual([]);
  expect(checked.slugProblem).toBeNull();
  expect(checked.blocking).toBe(0);
  expect(checked.claims).toEqual([]);
  expect(checked.seo[0]).toBeLessThan(60);
  expect(checked.seo[1]).toBeLessThan(160);
});

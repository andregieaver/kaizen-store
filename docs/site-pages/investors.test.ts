// The Investors page (`/investors`), made on 7 November 2026 at the owner's request ("an elevator pitch to investors in the Kaizena Flow
// project or other projects that come out of KaizenaLabs"), from docs/site-design.md's recipes in the feature pages' shape (6.11): the hero,
// the pitch in three cards, what is built, how Flow makes money, the lab, its three projects, the ask, questions and the end. Its main action
// is a mail to KaizenaLabs, not sign-up. No figure is claimed that the repository or production does not show: no revenue, users, round or
// valuation (the owner shares those in a conversation). Its sources are beside each row. Checked by `checkPage()` (parts.ts).
import { expect, it } from "vitest";

import { CARD, LINED, TURN_A, TURN_B, TURN_C, card, cardsRow, checkPage, dual, featureRow, highlightRow, id, lead, margin, onSand, pad, questionsRow, rich, para } from "./parts";

/** The address on the store's details and the site's footer (KaizenaLabs' `contact_email`), with the subject filled in. */
const MAIL = "mailto:support@kaizenalabs.com?subject=Investing%20in%20KaizenaLabs";

/** The page's main action: Talk to Us, a mail to KaizenaLabs, in the main action's shape (5.3). */
const talk = () => ({
  id: id(),
  type: "dualButton",
  first: { label: "Talk to Us", href: MAIL },
  second: { label: "", href: "", variant: "outline" },
  size: "lg",
  shape: "pill",
  gap: 30,
  align: "center",
  motion: { enter: { effect: "blur-up" } },
  style: margin(26, 0, 0, 30),
  at: { sm: { stack: true, style: margin(10, 20, 20, 30) } },
});
const under = (text: string, href: string) => rich([para({ text, href })], { style: margin(-20, 0, 0, 0), typography: { text: { align: "center" } } });

const faq: { q: string; bold: string; rest: string }[] = [
  // The About us page; the store's legal name and organisation number (the footer's business part).
  { q: "Who is behind Kaizena Flow?", bold: "KaizenaLabs, an AI lab in Oslo, Norway.", rest: "We build Kaizena Flow and Kaizen Life, and our organisation number is 915429777." },
  // The owner's request: investors in Flow or in other projects of the lab.
  { q: "Can I invest in a single project?", bold: "Yes, tell us which one.", rest: "We talk with investors about KaizenaLabs as a whole, or about Kaizena Flow, Kaizen Life or a project still in the lab." },
  // The live sign-up page (7 November 2026): "Kaizena Flow is in a private beta."
  { q: "Is Kaizena Flow live?", bold: "Yes, it runs in production.", rest: "Sign-up is in a private beta: we set up each new store with the owner." },
  // CLAUDE.md, Stack: Vercel functions in dub1 next to Supabase in eu-west-1 (Ireland); data processing kept in the EU.
  { q: "Where is the data kept?", bold: "In the EU.", rest: "Kaizena Flow runs in Dublin, next to its database, and keeps data processing in Europe." },
  // pnpm test: 17,107 unit tests on 7 November 2026, besides the integration and browser tests CI runs on every change.
  { q: "How is it built?", bold: "By people and AI agents together.", rest: "Every change runs through more than 17,000 automated tests, besides the tests in real browsers." },
  { q: "How do I see the numbers?", bold: "Ask us.", rest: "Write to support@kaizenalabs.com and we will share our numbers, plans and terms in a meeting." },
];

export function investorsPage() {
  const rows = [
    // The hero (6.1) with its own main action: a mail, as an investor has nothing to sign up for.
    {
      id: id(), type: "row", layout: "1", align: "middle", height: 50, style: pad(150, 20, 100),
      background: { ...TURN_B, opacity: 80 }, backgroundFixed: true, contentMax: 968, typography: { text: { align: "center" } },
      at: { sm: { height: 100, style: pad(0, 20, 0) } },
      columns: [{
        id: id(),
        blocks: [
          dual(1, "Investors", "Invest in AI That Runs Businesses", "dark-color"),
          lead("KaizenaLabs builds AI that does the work, not just the talking.", "Kaizena Flow, online stores run with an AI Store Manager, is our first platform. Kaizen Life is our second, and more are coming from the same engine."),
          talk(),
          under("Read the pitch", "#pitch"),
          { id: id(), type: "iconList", layout: "row", position: "center", gap: 20, iconSize: "lg", iconColor: "#3a4293", typography: { text: { size: { unit: "px", value: 18 }, weight: 500 } }, visibility: { hideAt: ["sm"] },
            items: ["Based in Oslo", "Live in production", "AI at the core", "Built for Europe"].map((text) => ({ id: id(), icon: "check", text, href: "" })) },
        ],
      }],
    },
    // The pitch: the problem, the answer, why now. The answer is what Kaizena Flow does today (docs/rules/admin, the decisions D94 to D478).
    cardsRow({
      htmlId: "pitch",
      eyebrow: "The Pitch",
      title: "One Platform and an AI Manager for Every Shop",
      tone: "light-color",
      bold: "Running an online shop takes a dozen tools and a team most shops cannot afford.",
      rest: "Kaizena Flow puts it all in one place, with an AI that does the work.",
      background: TURN_A,
      cards: [
        card("The", "Problem", "Shops pay for many tools and still do the work.", "A store, apps, a bookkeeping system, email marketing and a support desk, each with its own bill.", ["An app for every feature", "VAT and invoices by hand", "Hours of daily admin"]),
        card("Our", "Answer", "Kaizena Flow does it all in one place.", "The shop, the website, the books, marketing and customer care, with an AI Store Manager that asks before anything that matters.", ["Built in, not bolted on", "AI that acts on your yes", "Europe's rules included"]),
        card("Why", "Now", "AI can finally do real work.", "Agents that use tools can build pages, answer customers and keep the books. We built the platform around them from the first line.", ["Agents, not chatbots", "Built from scratch in 2026", "Ready for better models"]),
      ],
    }),
    // What is built: D94/D308 (the AI manager), D409 (Dream Factory), D241/D247 (themes and the theme store), D157/D159/D161 (VAT, invoices,
    // OSS and IOSS), D478 (our own ledger), D463 (Peppol), the Languages and Currencies page (28 countries, 27 languages of the owner's words).
    featureRow({
      eyebrow: "Kaizena Flow",
      title: "What Is Built Today",
      tone: "dark-color",
      bold: "A full commerce platform, live in production.",
      rest: "Sign-up is in a private beta while we bring on the first stores with care.",
      background: TURN_B,
      lines: [
        "An AI Store Manager that builds, sells and reports",
        "A whole store from one description",
        "A page builder, themes and a theme store",
        "VAT, OSS and IOSS, invoices and its own books",
        "Selling in 28 countries, in 27 languages",
        "Moving in from Shopify and WooCommerce",
      ],
    }),
    // The plans and the fee per sale (/pricing: four plans, the fee falling from Basic to Plus, yearly cheaper), premium themes (D286).
    // No amounts: the claims filter keeps money out of the page's words, and /pricing is where the prices live.
    featureRow({
      eyebrow: "Business Model",
      title: "How Flow Makes Money",
      tone: "light-color",
      bold: "Monthly plans and a small fee on each sale.",
      rest: "Shops pay more as they grow, and the theme store sells premium themes.",
      background: TURN_A,
      listFirst: true,
      lines: [
        "Four plans, from a first shop to a large business",
        "A fee per sale that falls on the bigger plans",
        "Yearly plans at a discount",
        "Premium themes in the theme store",
      ],
    }),
    // The About us page: an AI lab and development agency in Oslo, a hybrid team, a custom agentic AI engine, two products, client work.
    featureRow({
      eyebrow: "KaizenaLabs",
      title: "The Lab Behind Flow",
      tone: "dark-color",
      bold: "An AI lab and development agency in Oslo, Norway.",
      rest: "Our team is a hybrid of people and AI agents, and our own agentic AI engine sits at the core of everything we make.",
      background: TURN_B,
      lines: [
        "Kaizena Flow: online stores, run with AI",
        "Kaizen Life: your whole life in one app",
        "Custom solutions and advice for selected companies",
        "Experiments that grow into new products",
      ],
    }),
    // The lab's projects (About us): Flow, Life and the bridge between them, and what comes next from the same engine.
    highlightRow([
      { eyebrow: "Commerce", title: "Kaizena Flow", bold: "The AI-native store platform for Europe.", rest: "Live in production, with an AI Store Manager on every page.", link: { text: "Meet the AI Store Manager", href: "/store-manager" } },
      { eyebrow: "Life", title: "Kaizen Life", bold: "Email, social media and wearables in one place.", rest: "AI organises and automates everyday life, and a bridge connects it to Flow.", link: { text: "Visit KaizenaLabs", href: "https://kaizenalabs.com" } },
      { eyebrow: "Next", title: "New Projects", bold: "One engine, many products.", rest: "Each new product starts from the same agentic AI engine, so it is built faster. Ask us what is in the lab." },
    ]),
    // The ask, in a highlighted card (6.5): what the owner shares in a meeting, never stated here.
    {
      id: id(), type: "row", layout: "1", style: pad(100, 20, 100), background: TURN_B, backgroundFixed: true, contentMax: 880, at: { sm: { contentMax: 320 } },
      columns: [{
        id: id(), ...onSand, ...CARD, ...LINED, style: pad(36, 30, 40), typography: { text: { color: "#171717", align: "center" } },
        blocks: [
          dual(2, "The Ask", "Partners Who Believe in AI That Works", "light-color"),
          lead("We welcome investors in KaizenaLabs as a whole, or in a single project.", "Our numbers, plans and terms are shared in a meeting. Write to us and tell us what interests you."),
          talk(),
        ],
      }],
    },
    questionsRow(faq, TURN_A),
    // The end (6.7): the mail again, and About us as the text link.
    {
      id: id(), type: "row", layout: "1", align: "middle", style: pad(100, 20, 100), background: TURN_C, backgroundFixed: true, contentMax: 968,
      typography: { text: { align: "center" } }, at: { sm: { contentMax: 320 } },
      columns: [{
        id: id(), ...onSand,
        blocks: [
          dual(2, "Let's Talk", "Build the Future of Commerce With Us", "dark-color"),
          lead("Write to us and we will set up a meeting.", "Or read more about who we are first."),
          talk(),
          under("About us", "/about-us"),
        ],
      }],
    },
  ];
  return {
    title: "Investors",
    slug: "investors",
    seo: {
      title: "Investors: KaizenaLabs and Kaizena Flow",
      description: "KaizenaLabs in Oslo builds AI that runs businesses: Kaizena Flow, the AI-native store platform for Europe, Kaizen Life and what comes next.",
    },
    rows,
    tags: [],
    categories: [],
    thumbnail: null,
    aiAssistants: true,
    searchEngines: true,
  };
}

it("builds the Investors page as the editor would save it", () => {
  const checked = checkPage("investors", investorsPage());
  expect(checked.errors).toEqual([]);
  expect(checked.slugProblem).toBeNull();
  expect(checked.blocking).toBe(0);
  expect(checked.claims).toEqual([]);
  expect(checked.seo[0]).toBeLessThan(60);
  expect(checked.seo[1]).toBeLessThan(160);
});

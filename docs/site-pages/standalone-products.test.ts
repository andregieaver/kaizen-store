// The four product pages of the extensions sold on their own (D748 E7 part four, docs/extensions.md 7): /support-desk, /email-automation,
// /work and /deals, from docs/site-design.md's recipes in the feature pages' shape (6.11): the hero, three cards, feature rows, questions and
// the end. Their main action is the sign-up for extensions with the product ticked (`/sign-up/extensions?with=…`), which answers once the
// owner opens it (STANDALONE_SIGNUP_OPEN). Every line is built today; its sources are beside each page (docs/support.md, docs/flows.md,
// docs/work.md, docs/contracts.md, the rules in docs/rules/admin and the decisions named). Checked by `checkPage()` (parts.ts).
import { expect, it } from "vitest";

import { TURN_A, TURN_B, card, cardsRow, checkPage, endRow, featureRow, hero, questionsRow } from "./parts";

type Feature = { eyebrow: string; title: string; bold: string; rest: string; lines: string[] };
type Product = {
  id: string;
  slug: string;
  title: string;
  seo: { title: string; description: string };
  hero: { eyebrow: string; title: string; bold: string; rest: string; claims: string[] };
  cards: { heading: { eyebrow: string; title: string; bold: string; rest: string }; items: [string, string, string, string, string[]][] };
  features: Feature[];
  faq: { q: string; bold: string; rest: string }[];
  end: { title: string; bold: string; rest: string };
};

/** After a trial: 14 days of grace, then read-only with everything kept to read and export (docs/extensions.md 2 and 4.3). */
const AFTER_TRIAL = {
  q: "What happens after the free trial?",
  bold: "You choose whether to keep it.",
  rest: "Add it to your account to keep it running. If you do not, everything is kept for you to read and export.",
};

/** A product page from its words, in the feature pages' shape (6.11). */
function productPage(p: Product) {
  const action = { label: "Start Your Free Trial", href: `/sign-up/extensions?with=${p.id}` };
  const turns = [TURN_B, TURN_A];
  return {
    title: p.title,
    slug: p.slug,
    seo: p.seo,
    rows: [
      hero({ ...p.hero, anchor: { text: "See how it works", href: "#how" }, action }),
      cardsRow({ ...p.cards.heading, tone: "light-color", htmlId: "how", background: TURN_A, cards: p.cards.items.map(([first, rest, bold, words, lines]) => card(first, rest, bold, words, lines)) }),
      ...p.features.map((f, i) => featureRow({ ...f, tone: i % 2 ? "light-color" : "dark-color", background: turns[i % 2], listFirst: i % 2 === 1 })),
      questionsRow([...p.faq, AFTER_TRIAL], turns[p.features.length % 2]),
      endRow({ eyebrow: "Start today", ...p.end, background: turns[(p.features.length + 1) % 2], action, after: { label: "See the prices", href: "/pricing" } }),
    ],
    tags: [],
    categories: [],
    thumbnail: null,
    aiAssistants: true,
    searchEngines: true,
  };
}

const NO_STORE = (what: string) => ({ q: "Do I need an online store?", bold: "No.", rest: `${what} runs on its own, and you can add an online store later.` });

// docs/support.md 2.3 to 2.10, D216 (steps 3 to 14), D332 (email in), D582 and D583 (the website chat reading its site), the store nav's
// support pages. Not claimed: WhatsApp, Messenger, text messages, phone (docs/support.md 1.6).
export const SUPPORT_DESK: Product = {
  id: "support_desk",
  slug: "support-desk",
  title: "Support Desk",
  seo: {
    title: "AI Support Desk: Kaizena Flow",
    description: "One inbox for every customer email and chat, answered by AI where it can and by your team where it should. Try it free for 14 days.",
  },
  hero: {
    eyebrow: "Kaizena Support Desk",
    title: "Every Customer Answered",
    bold: "One inbox for every email and chat, answered by AI where it can and by you where it should.",
    rest: "No online store needed. Try it free for 14 days.",
    claims: ["One shared inbox", "AI answers first", "You stay in charge"],
  },
  cards: {
    heading: { eyebrow: "How it works", title: "Answer Everyone From One Place", bold: "Email and chat, together.", rest: "Customers write the way they like, and your team sees it all in one inbox." },
    items: [
      ["One", "inbox", "Email and chat side by side.", "Forward your support mailbox and add the chat to your websites: every conversation arrives in one inbox, live.", ["Email threads stay together", "Chat on your own websites", "Waiting, mine and ended at a glance"]],
      ["AI", "first", "The AI answers what it can.", "It reads your own website to answer, and hands over to a person whenever a customer asks for one.", ["Answers in the customer's language", "A person whenever they ask", "AI first, or people only"]],
      ["Your", "team", "Take over any conversation.", "Answer, pass it to a colleague or give it back to the AI, with a draft reply ready beside you.", ["A draft for every answer", "Saved replies", "Opening hours and alerts"]],
    ],
  },
  features: [
    {
      eyebrow: "Know how it goes",
      title: "Reports in Plain Words",
      bold: "See what the desk did.",
      rest: "How many conversations, how many the AI handled alone, how long people waited and what they thought of it.",
      lines: ["Conversations and waiting times", "What the AI handled alone", "Ratings from customers", "A summary when a conversation ends", "The topics customers ask about"],
    },
    {
      eyebrow: "Care built in",
      title: "Unhappy Customers Reach You Fast",
      bold: "Every message gets a mood score.",
      rest: "A conversation turning sour can go straight to your team, and a business with sensitive matters is answered by people only.",
      lines: ["A mood score on every message", "An alert when a conversation turns sour", "People only, when you choose", "Transcripts kept for 30, 60 or 90 days"],
    },
  ],
  faq: [
    NO_STORE("The support desk"),
    { q: "Which channels does it answer?", bold: "Email, and the chat on your websites.", rest: "Customers write to your support address or use the chat you add to your sites with one tag." },
    { q: "Does the AI answer customers on its own?", bold: "Only if you want it to.", rest: "Choose AI first and it answers by itself, or people only and it drafts the replies your team sends." },
    { q: "Which languages does it speak?", bold: "Norwegian, Swedish, Danish and English.", rest: "Customers see the chat in their language, and the AI answers in the language they write in." },
  ],
  end: { title: "Try the Support Desk Free", bold: "Free for 14 days.", rest: "Set it up in minutes and see your first conversations today." },
};

// D295 to D298 (consent, segments, broadcasts, automatic emails), D352 (products from the catalogue, AI suggests words), D368 (templates),
// D653, D730 (sending pauses), D764 (no more than three a week, quiet hours), D767 and docs/flows.md (flows, the canvas, dry run, checks,
// the report in words). Not claimed: open tracking (none), an own sending domain for an account without a store (E10), A/B tests of emails.
export const EMAIL_AUTOMATION: Product = {
  id: "email_automation",
  slug: "email-automation",
  title: "Email Automation",
  seo: {
    title: "Email Automation: Kaizena Flow",
    description: "Newsletters, segments and flows that send themselves, with consent done properly and reports in plain words. Try it free for 14 days.",
  },
  hero: {
    eyebrow: "Kaizena Email Automation",
    title: "Emails That Send Themselves",
    bold: "Newsletters, segments and flows that reach the right people at the right moment.",
    rest: "With consent done properly. Try it free for 14 days.",
    claims: ["Newsletters", "Flows", "Clear reports"],
  },
  cards: {
    heading: { eyebrow: "How it works", title: "Write Once, Reach the Right People", bold: "Three ways to stay in touch.", rest: "Send news when you have it, and let the rest go out by itself." },
    items: [
      ["Send", "newsletters", "Build an email from blocks.", "Start from a template, add your products with their live prices, and send now or at a set time.", ["Templates to start from", "Products straight from your catalogue", "Send to everyone or a segment"]],
      ["Automatic", "emails", "Welcome, thank you and come back.", "Ready-made emails go out by themselves after a sign-up, a purchase or a quiet spell.", ["Welcome and win-back", "Restock alerts and buy again", "Up to two follow-ups each"]],
      ["Flows", "as a story", "A series of emails you can read.", "Waits, yes-or-no branches and goals on one canvas, tested before anyone gets them.", ["Start from a goal", "Preview on a phone and in dark mode", "A forecast before you switch it on"]],
    ],
  },
  features: [
    {
      eyebrow: "Who gets what",
      title: "Segments That Stay Fresh",
      bold: "Choose people by what they did.",
      rest: "A segment is counted again every time it is used, so an email always goes to the right group.",
      lines: ["Rules on what people did", "Counted again on every send", "Used by newsletters and flows"],
    },
    {
      eyebrow: "Respectful by default",
      title: "Consent Done Properly",
      bold: "Only people who said yes get your emails.",
      rest: "Sign-ups are confirmed by email, every email has a one-click unsubscribe, and nobody is mailed too often.",
      lines: ["Confirmed by email", "One-click unsubscribe", "No more than three marketing emails a week", "Quiet hours at night", "Sending pauses if bounces climb"],
    },
    {
      eyebrow: "Know what worked",
      title: "Reports in Plain Words",
      bold: "See who started, what was sent and what came of it.",
      rest: "Clicks are counted per person, and orders are credited to the email that led to them.",
      lines: ["Clicks per person", "Orders after each email", "Which email worked best", "One suggestion to do better"],
    },
  ],
  faq: [
    { q: "Where do my subscribers come from?", bold: "From your store's sign-up forms, checkout and customer accounts.", rest: "Each person is added with what they agreed to and when, ready to be shown if anyone asks." },
    { q: "Can I write in several languages?", bold: "Yes.", rest: "An email can be written in each of your store's languages, and each person gets their own." },
    { q: "Do you count opens?", bold: "No, we count clicks.", rest: "Reports show who clicked and the orders that followed an email." },
    { q: "Will the AI write my emails?", bold: "It can suggest the words.", rest: "Products and prices always come from your catalogue, never from the AI." },
  ],
  end: { title: "Try Email Automation Free", bold: "Free for 14 days.", rest: "Your first flow can be running this afternoon." },
};

// D122 to D124 (clients, jobs, time, invoices, reports), D478 to D506 (the books, bank statements, receipts, the VAT return, the year-end),
// D512 (the accountant), D494 and D499 (bringing invoices in), docs/rules/admin/ai.md (Work tools). Not claimed: card payment of an invoice,
// filing the VAT return directly, sending e-invoices, a live bank feed, payroll; the books are for Norwegian businesses (ledger PACKS).
export const WORK: Product = {
  id: "work",
  slug: "work",
  title: "Work",
  seo: {
    title: "Work: Clients, Time and Invoices | Kaizena Flow",
    description: "Log your time, send proper invoices and keep your books in one place, made for consultants and small firms. Try it free for 14 days.",
  },
  hero: {
    eyebrow: "Kaizena Work",
    title: "Clients, Time and Invoices in One Place",
    bold: "Log your time, send proper invoices and keep your books, without another system.",
    rest: "Made for consultants and small firms. Try it free for 14 days.",
    claims: ["Time tracking", "Invoices", "Your own books"],
  },
  cards: {
    heading: { eyebrow: "How it works", title: "From Hours to Paid", bold: "Everything a working day needs.", rest: "Keep your clients, count your time and invoice it, all in one place." },
    items: [
      ["Clients", "and jobs", "Everything about a client together.", "Each client with their jobs, by the hour or at a fixed fee, with estimates that warn you before you pass them.", ["By the hour or a fixed fee", "Tasks and estimates", "Norwegian companies filled in for you"]],
      ["Time", "that counts", "One timer that follows you.", "Start the timer, switch jobs, and see the hours of each client and period.", ["One running timer per person", "Time per job and task", "Reports per client and period"]],
      ["Invoices", "done right", "Numbered, locked and sent by email.", "Invoices with VAT on each line go to your client with a link to view them, and corrections are made with credit notes.", ["Numbers with no gaps", "Payment reminders", "Repeating invoices prepared for you"]],
    ],
  },
  features: [
    {
      eyebrow: "Your own books",
      title: "Bookkeeping That Keeps Itself",
      bold: "Every invoice and payment is posted for you.",
      rest: "See your trial balance, profit and loss and balance sheet, made for Norwegian businesses.",
      lines: ["Posted from invoices and payments", "Bank statements matched to invoices", "Receipts read by AI for you to check", "The VAT return worked out from your books", "The year-end close"],
    },
    {
      eyebrow: "Work with your accountant",
      title: "Invite Your Accountant",
      bold: "Your accountant gets their own way in.",
      rest: "They see what they need, and only they can open a locked period again.",
      lines: ["An accountant's own role", "Periods locked when they are done", "Print and spreadsheet exports", "Invoices brought in from Tripletex"],
    },
  ],
  faq: [
    NO_STORE("Work"),
    { q: "Can my clients pay by card?", bold: "Not yet.", rest: "Your invoice tells them how to pay, and you record the payment when it arrives." },
    { q: "Is the bookkeeping for every country?", bold: "It is made for Norwegian businesses.", rest: "Invoices can be written in Norwegian, Swedish, Danish and English, and the books follow the Norwegian chart of accounts." },
    { q: "Can the AI help?", bold: "Yes, on your say-so.", rest: "Ask the AI manager for the overview, to log time or to prepare an invoice: it asks you before it issues one." },
  ],
  end: { title: "Try Work Free", bold: "Free for 14 days.", rest: "Log your first hours today and send your first invoice when you are ready." },
};

// D464 (deals and pipelines), D468 (activities), D475 (the leads inbox), D476 (filing email), D462 (one timeline), D520 (sales reports),
// D477 (moving from Pipedrive), docs/contracts.md (templates, signing with an email code, the sealed PDF, reminders; D695).
// Not claimed: BankID or another national ID, a qualified seal; the AI manager never sends a contract.
export const DEALS: Product = {
  id: "deals",
  slug: "deals",
  title: "Deals and Contracts",
  seo: {
    title: "Deals and Contracts: Kaizena Flow",
    description: "Follow every deal on one board, keep every lead and get contracts signed online. Try Deals and Contracts free for 14 days.",
  },
  hero: {
    eyebrow: "Kaizena Deals",
    title: "From First Talk to Signed Contract",
    bold: "Follow every deal on one board and get contracts signed online.",
    rest: "Simple enough to use every day. Try it free for 14 days.",
    claims: ["Deals on a board", "A leads inbox", "Contracts signed online"],
  },
  cards: {
    heading: { eyebrow: "How it works", title: "Win More, Forget Nothing", bold: "Your sales in one place.", rest: "Every lead, deal and contract where you can see it." },
    items: [
      ["Deals", "on a board", "See where every deal stands.", "Drag deals between stages, each with a value, an expected close and an owner.", ["Several pipelines", "A chance of winning per stage", "A reason asked when a deal is lost"]],
      ["Leads", "in one place", "Nobody who asks is forgotten.", "Requests, form messages and new contacts arrive in one inbox, ready to become a deal.", ["A deal in one press", "Activities with a Today list", "Emails filed to the customer"]],
      ["Contracts", "signed online", "Send, sign, done.", "Fill a contract from the deal, send it, and your customer signs with a code sent to their email.", ["Templates in Norwegian and English", "A sealed PDF for every signer", "Reminders until it is signed"]],
    ],
  },
  features: [
    {
      eyebrow: "Know your numbers",
      title: "Sales Reports That Look Ahead",
      bold: "See what is likely to close, and when.",
      rest: "A forecast weighted by each stage's chance, how deals move from stage to stage and how long they take to win.",
      lines: ["A forecast by chance of winning", "How deals move between stages", "Won and lost per person", "Time to win"],
    },
    {
      eyebrow: "Moving over",
      title: "Bring Your Deals From Pipedrive",
      bold: "Move in without typing it all again.",
      rest: "Companies, people, pipelines, deals, activities and notes come over, with a dry run first.",
      lines: ["A dry run before anything moves", "Nothing is ever written back", "Your own extra fields on deals"],
    },
  ],
  faq: [
    NO_STORE("Deals and Contracts"),
    { q: "How do customers sign?", bold: "With a code sent to their email.", rest: "They type their name and agree, and the signed PDF records who signed, when and from where. It is a simple electronic signature, not BankID." },
    { q: "Can the AI send contracts?", bold: "No, you press Send.", rest: "The AI manager can draft a contract, move deals and log activities, but sending is always yours." },
    { q: "Which languages are the contracts in?", bold: "Norwegian and English.", rest: "Start from a template in either, and the signing page speaks the contract's language." },
  ],
  end: { title: "Try Deals and Contracts Free", bold: "Free for 14 days.", rest: "Put your first deals on the board today." },
};

export const PRODUCTS = [SUPPORT_DESK, EMAIL_AUTOMATION, WORK, DEALS];

for (const product of PRODUCTS) {
  it(`builds the ${product.title} page as the editor would save it`, () => {
    const checked = checkPage(product.slug, productPage(product));
    expect(checked.errors).toEqual([]);
    expect(checked.slugProblem).toBeNull();
    expect(checked.blocking).toBe(0);
    expect(checked.claims).toEqual([]);
    expect(checked.seo[0]).toBeLessThan(60);
    expect(checked.seo[1]).toBeLessThan(160);
  });
}

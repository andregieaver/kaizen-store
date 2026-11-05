// The Store Manager page (`/store-manager`), made again on 5 November 2026 from docs/site-design.md's recipes in the shape of the feature
// pages the owner published that day (6.11): the hero, three cards, alternating feature rows, the levels of autonomy, three highlighted
// cards, questions and the main action. Every line says what the AI manager does today; the source of each is beside it
// (docs/rules/admin/ai.md, the decisions, the tools in src/lib/owner-tools.ts). Checked by `checkPage()` (parts.ts).
import { expect, it } from "vitest";

import { CARD, TURN_A, TURN_B, TURN_C, cardsRow, checkPage, endRow, featureRow, h3, hero, highlightRow, highlighted, id, lead, onSand, pad, questionsRow, card } from "./parts";

const faq: { q: string; bold: string; rest: string }[] = [
  // NEVER_AUTOMATIC and the levels per area (src/lib/autopilot-autonomy.ts, D309).
  {
    q: "Does it change things without asking?",
    bold: "Only where you let it.",
    rest: "You choose a level for each area. Refunds, emails to your whole list, who works in the store and your plan always wait for your yes.",
  },
  // Sums in code, grounding (CLAUDE.md, AI features; D94, D104).
  {
    q: "Where do its figures come from?",
    bold: "From your store's own records.",
    rest: "Sums and averages are worked out in code, never guessed, and it never states a price or a stock level it was not given.",
  },
  // D94: owners; audit_log.acted_by (person, ai_manager, autopilot).
  {
    q: "Who can use it?",
    bold: "The store's owners.",
    rest: "Every change it makes is written in the activity log as the AI's, so you always see who did what.",
  },
  // Memory (D103, D350): the Memory tab, Forget, Learn from my conversations; never customers' details or passwords.
  {
    q: "Does it learn about my business?",
    bold: "Yes, if you want it to.",
    rest: "It remembers what you tell it and how you work. You see it all on the Memory tab, can change or forget any of it, and can turn learning off.",
  },
  // customerEmailsPerWeek; send_broadcast is never automatic.
  {
    q: "Does it write to my customers?",
    bold: "Only as you allow.",
    rest: "A message to one customer waits for your yes, unless you let it send them itself up to a number a week. An email to your whole list always waits for you.",
  },
  // The Autopilot page: Stop (what it did stays), Autopilot on/off (off pauses every plan).
  {
    q: "Can I stop it?",
    bold: "At any time.",
    rest: "Stop a plan and what it already did stays. Switch the autopilot off and every plan pauses until you switch it on again.",
  },
];

const level = (first: string, rest: string, bold: string, words: string) => ({ id: id(), ...onSand, ...CARD, style: pad(40, 24, 46), blocks: [h3(first, rest), lead(bold, words)] });

function storeManagerPage() {
  const rows = [
    hero({
      eyebrow: "Kaizena Store Manager",
      title: "Run Your Store by Asking",
      bold: "No need to hire.",
      rest: "Your AI Store Manager answers your questions, builds what you ask for and does the daily work, and it asks before anything that matters.",
      anchor: { text: "See what it can do", href: "#manager" },
      claims: ["Ask in your own words", "Works toward your goals", "Waits for your yes"],
    }),
    // What it is, in three cards. The admin map (D103), reports from code (D346), the autopilot's goals and plans (D309).
    cardsRow({
      htmlId: "manager", eyebrow: "One assistant", title: "Your whole admin, one question away", tone: "light-color", background: TURN_A,
      bold: "Open it beside any page.", rest: "It knows every screen of the admin, works from your store's own figures and does the work you ask for.",
      cards: [
        card("Ask", "anything", "How did last week go?", "Get the answer in plain words, from your own sales.", ["Sales, customers and stock", "Sums worked out, never guessed", "Any answer kept as a report"]),
        card("Tell", "it what to do", "Add the new products. Start a sale.", "Answer that customer. It prepares it all.", ["Products, prices and pages", "Sales, campaigns and emails", "Orders, returns and exchanges"]),
        card("Leave", "it running", "Give it a goal.", "It makes a plan, works through it and tells you how it went.", ["Goals measured from your figures", "Plans that start on your yes", "A report every week"]),
      ],
    }),
    // Figures: sales_trend, customer_insights, product_performance, sales_funnel, restock_suggestions, vat_report and oss_return_data,
    // save_report and schedule_report (D104, D346, AGT-01).
    featureRow({
      eyebrow: "Know your numbers", title: "Answers from your own figures", tone: "dark-color", background: TURN_B,
      bold: "Ask in plain words and get the figures back,", rest: "worked out in code from your store's own orders. No spreadsheets and no guessing.",
      lines: [
        "How sales and orders moved, by day, week or month",
        "Who comes back, who is new and who has gone quiet",
        "What sells, what does not, and searches that found nothing",
        "Which products run low, and how many to order",
        "Your VAT and OSS figures, ready for your accountant",
        "Any answer kept as a report, or emailed to you on a schedule",
      ],
    }),
    // Building: create_product and write_product_texts (drafts, D308), build_page with its pictures (page_ai_jobs), save_menu and
    // set_header_footer, look_at_page at a phone's and a computer's width (D310), legal pages from the official texts (D311, L2 and L3).
    featureRow({
      eyebrow: "Builds for you", title: "Products and pages, made for you", tone: "light-color", background: TURN_A, listFirst: true,
      bold: "Describe what you want, and it is made as a draft", rest: "for you to check, in your own look and words.",
      lines: [
        "New products with texts, prices and variants, saved as drafts",
        "Product texts written from each product's own facts",
        "Whole pages built from a few words, with pictures to match",
        "Menus, header and footer set up for you",
        "It looks at your pages on a phone and a computer, and says what it sees",
        "Your terms written from the law's own texts, and kept up to date",
      ],
    }),
    // Marketing: create_discount and create_campaign, draft_broadcast (send_broadcast never automatic), count_segment and tag_customer,
    // switch_email_automation, loyalty, bonus and affiliate programs, suggest_experiments, start_experiment and apply_winner (D318).
    featureRow({
      eyebrow: "Grows the shop", title: "Marketing, ready when you are", tone: "dark-color", background: TURN_B,
      bold: "Ask for a sale, a campaign or an email,", rest: "and it prepares everything. You read it, and it goes out on your yes.",
      lines: [
        "Discount codes and sale campaigns from one sentence",
        "Emails to your list drafted for the right customers, sent only when you say so",
        "Customer groups counted and tagged",
        "Email automations switched on when you are ready",
        "Loyalty rewards, bonus and affiliate programs kept up to date",
        "Two versions of a page tested, and the winner put live",
      ],
    }),
    // The day's work: tag_orders, mark_order_sent, resend_order_email, approve_return and decline_return, propose_exchange,
    // preview_order_change then change_order, set_draft_prices and send_draft_order (D437), reply_to_support, receive_purchase_order.
    featureRow({
      eyebrow: "Runs the day", title: "The daily work, handled", tone: "light-color", background: TURN_A, listFirst: true,
      bold: "Orders, returns and customer messages,", rest: "sorted in a few words, with the customer's history at hand.",
      lines: [
        "Orders tagged, marked as sent and their emails sent again",
        "Returns approved or declined, and exchanges offered",
        "Order changes priced first, then made on your yes",
        "Quotes priced and sent to the customers who asked",
        "Replies to customers drafted, and sent when you approve them",
        "Stock counted in when a delivery arrives",
      ],
    }),
    // The autopilot: goals of up to five targets (D309), plans started on a yes or at once (D328), reacting to events (D331),
    // follow-ups daily or weekly (AGT-04), the weekly report (B3b) and what its changes moved two weeks on (D418), Autopilot on/off.
    featureRow({
      eyebrow: "Autopilot", title: "It keeps working while you are away", tone: "dark-color", background: TURN_B,
      bold: "Give it a goal, such as more orders this month.", rest: "It makes a plan, works through it step by step and tells you how it went.",
      lines: [
        "Up to five targets, measured from your store's own figures",
        "Plans that start when you say yes, or at once if you allow it",
        "It steps in when a customer waits, a test ends or an alert goes off",
        "It comes back to a task when you ask, such as a stock check every Monday",
        "A weekly report, and how sales moved in the two weeks after each change",
        "Pause it at any time, and nothing is lost",
      ],
    }),
    // You stay in charge: the three levels (LEVEL_WORDS), the areas (AUTONOMY_AREAS), the limits (discount, price change, emails a
    // week) and NEVER_AUTOMATIC as the settings page words it; the activity log's acted_by.
    cardsRow({
      eyebrow: "You decide", title: "You stay in charge", tone: "dark-color", background: TURN_C,
      bold: "Choose how far it goes, area by area:", rest: "products, website, design, store setup, marketing, messages to customers and money.",
      cards: [
        level("Ask", "me first", "Every change waits for your yes.", "A card shows exactly what it will do, and you press Approve or Decline."),
        level("Do", "it and tell me", "It makes the change and says what it did,", "so you can look whenever it suits you."),
        level("Just", "do it", "It gets on with it,", "within the limits you set: the deepest discount, the largest price change and how many emails a week."),
      ],
      after: [
        highlighted(
          "Some things always wait for your yes:",
          "refunds and order changes, emails to your whole list, who works in the store, your domains, your plan and opening the store. Everything it does is in the activity log.",
        ),
      ],
    }),
    // Your way: the panel beside the page and ⌘K (D103), voice mode (D104, D105), memory (D103), saved skills and notices (D350), the
    // open owner MCP for Claude, ChatGPT and other assistants (D439).
    featureRow({
      eyebrow: "Your way", title: "Type it, say it, or ask from anywhere", tone: "light-color", background: TURN_A, listFirst: true,
      bold: "Talk to it the way that suits you.", rest: "It remembers how you like things done, and tells you what it finished while you were away.",
      lines: [
        "Open it beside any page of the admin, or press ⌘K",
        "Hands-free voice mode: just talk, and it answers aloud",
        "It remembers your business and how you like things, and you can see and change what it knows",
        "Save a job you repeat as a skill, and use it by name",
        "Notices of what it finished or waits on while you were away",
        "Connect Claude, ChatGPT or another AI assistant to your store",
      ],
    }),
    // The Dream Factory (D409), web research (D329), brand, look and logo (D330).
    highlightRow([
      { eyebrow: "Dream Factory", title: "A whole store from one description", bold: "Describe your business,", rest: "and it builds the store: products, pages, a look and legal pages, ready for you to open.", link: { text: "Dream Factory", href: "/dream-factory" } },
      { eyebrow: "Research", title: "It looks things up for you", bold: "It searches the web and reads the pages,", rest: "keeps notes with their sources and compares your options side by side." },
      { eyebrow: "Your brand", title: "A look and a logo of your own", bold: "It writes down your brand's voice,", rest: "designs a look with colours that are easy to read and draws your logo from your font." },
    ]),
    questionsRow(faq),
    endRow({ eyebrow: "Ready?", title: "Meet your AI Store Manager", bold: "Open your store and ask your first question.", rest: "It is there on every page of the admin." }),
  ];
  return {
    title: "Store Manager",
    slug: "store-manager",
    seo: {
      title: "AI Store Manager for your shop | Kaizena Flow",
      description: "An AI that answers from your own figures, builds products and pages, runs marketing and the daily work, and asks before anything that matters.",
    },
    rows,
    tags: [],
    categories: [],
    thumbnail: null,
    aiAssistants: true,
    searchEngines: true,
  };
}

it("builds the Store Manager page as the editor would save it", () => {
  const checked = checkPage("store-manager", storeManagerPage());
  expect(checked.errors).toEqual([]);
  expect(checked.slugProblem).toBeNull();
  expect(checked.blocking).toBe(0);
  expect(checked.claims).toEqual([]);
  expect(checked.seo[0]).toBeLessThan(60);
  expect(checked.seo[1]).toBeLessThan(160);
});

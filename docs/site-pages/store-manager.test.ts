// The Store Manager page (`/store-manager`), made again on 5 November 2026 from docs/site-design.md's recipes and the shape of the feature
// pages the owner published that day (Customer Care, Campaigns, Discounts): the hero, three cards, alternating feature rows, the levels of
// autonomy, three highlighted cards, questions and the main action. Every line says what the AI manager does today; the source of each is
// beside it (docs/rules/admin/ai.md, the decisions, the tools in src/lib/owner-tools.ts). The page is checked as savePage() checks it:
// pageInput, then the page checker with the platform's theme and text styles, then the claims filter over its words. Writes
// `store-manager.page.json` and `store-manager.check.json` to the system's temporary folder (`kaizena-site-pages`), never into the repository.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { findClaims } from "@/lib/claims";
import { inlinePlain } from "@/lib/inline-text";
import { blockingIssues, pageIssues, themeSetsOf } from "@/lib/page-a11y";
import { pageInput, pageSlugProblem } from "@/lib/page-content";
import { textStylesCss } from "@/lib/text-styles";
import { parseStoreTheme } from "@/lib/theme";

const id = () => randomUUID();
const SAND = "#908064";
const ICON = "#3a4293";
const TEXT = "#171717";

// The owner's feature pages of 5 November take the gradients at 35°: A towards #ededed, B towards white, C a plain sand band.
const TURN_A = { type: "gradient", style: "shift", flow: "still", angle: 35, colors: [SAND, "#ededed"] };
const TURN_B = { type: "gradient", style: "shift", flow: "still", angle: 35, colors: [SAND, "#ffffff"] };
const TURN_C = { type: "color", color: SAND, opacity: 9 };
const HERO_BG = { ...TURN_B, opacity: 80 };
const pad = (top: number, side: number, bottom: number) => ({ padding: { top, left: side, right: side, bottom } });
const margin = (top: number, left: number, right: number, bottom: number) => ({ margin: { top, left, right, bottom } });
const onSand = { typography: { text: { color: TEXT } } };
// A card of its own on a sand row (the owner's: white at half, medium shadow, small corners).
const CARD = { radius: 6, shadow: "md", background: { type: "color", color: "#ffffff", opacity: 50 } };
// The highlighted card (6.5): the line round it, thicker on top.
const LINED = { border: { style: "solid", color: "#c4bcad", width: { top: 5, left: 1, right: 1, bottom: 1 } } };

type Mark = { type: "bold" } | { type: "link"; attrs: { href: string } };
type Run = { text: string; bold?: boolean; href?: string };
const runs = (parts: Run[]) =>
  parts.map((p) => {
    const marks: Mark[] = [...(p.bold ? [{ type: "bold" } as const] : []), ...(p.href ? [{ type: "link", attrs: { href: p.href } } as const] : [])];
    return { type: "text", text: p.text, ...(marks.length ? { marks } : {}) };
  });
const para = (...parts: Run[]) => ({ type: "paragraph", content: runs(parts) });
const doc = (...content: unknown[]) => ({ type: "doc", content });
const rich = (content: unknown[], extra: Record<string, unknown> = {}) => ({ id: id(), type: "richText", doc: doc(...content), ...extra });
const lead = (bold: string, rest: string, extra: Record<string, unknown> = {}) => rich([para({ text: bold, bold: true }, ...(rest ? [{ text: ` ${rest}` }] : []))], extra);

const dual = (level: 1 | 2, eyebrow: string, title: string, tone: "light-color" | "dark-color", extra: Record<string, unknown> = {}) => ({
  id: id(),
  type: "heading",
  level,
  stack: true,
  className: "heading-on-light",
  text: `<span class="super-heading ${tone}${level === 1 ? " green-text" : ""}">${eyebrow}</span>`,
  second: title,
  typography: { ...(level === 2 ? { text: { color: TEXT } } : {}), first: { size: { unit: "px", value: level === 1 ? 30 : 18 } } },
  ...extra,
});
const h3 = (first: string, rest: string) => ({
  id: id(),
  type: "heading",
  level: 3,
  text: `<span class="green-text ts-colour">${first}</span> ${rest}`,
  typography: { text: { size: { unit: "px", value: 30 } } },
});
const checks = (lines: string[], extra: Record<string, unknown> = {}) => ({
  id: id(),
  type: "iconList",
  items: lines.map((text) => ({ id: id(), icon: "check", text, href: "" })),
  iconSize: "lg",
  iconColor: ICON,
  gap: 21,
  typography: { text: { size: { unit: "px", value: 18 } } },
  ...extra,
});
const smallChecks = (lines: string[]) => checks(lines, { typography: { text: { size: { unit: "px", value: 17 }, align: "left" } } });
const mainAction = () => ({
  id: id(),
  type: "dualButton",
  first: { label: "Get Started with Flow", href: "/sign-up" },
  second: { label: "", href: "", variant: "outline" },
  size: "lg",
  shape: "pill",
  gap: 30,
  align: "center",
  motion: { enter: { effect: "blur-up" } },
  style: margin(26, 0, 0, 30),
  at: { sm: { stack: true, style: margin(10, 20, 20, 30) } },
});
const textLink = (text: string, href: string) => rich([para({ text, href })], { style: margin(-20, 0, 0, 0), typography: { text: { align: "center" } } });

/** A card of the three under a section's heading (6.4, as the owner's feature pages draw them). */
const card = (first: string, rest: string, bold: string, words: string, lines: string[]) => ({
  id: id(),
  ...onSand,
  ...CARD,
  style: pad(40, 24, 46),
  blocks: [h3(first, rest), lead(bold, words), smallChecks(lines)],
});

/** A feature row (6.3): the section's words beside a list, taking turns side; `listFirst` puts the list left and the words first on a phone. */
function featureRow(o: {
  eyebrow: string;
  title: string;
  tone: "light-color" | "dark-color";
  bold: string;
  rest: string;
  lines: string[];
  background: Record<string, unknown>;
  listFirst?: boolean;
  htmlId?: string;
}) {
  const words = { id: id(), ...onSand, width: 40, radius: 20, ...(o.listFirst ? { style: pad(40, 0, 40) } : {}), blocks: [dual(2, o.eyebrow, o.title, o.tone), lead(o.bold, o.rest)] };
  const list = { id: id(), ...onSand, width: 60, ...(o.listFirst ? {} : { at: { sm: { style: margin(-40, 0, 0, 0) } } }), blocks: [checks(o.lines)] };
  return {
    id: id(),
    type: "row",
    ...(o.htmlId ? { htmlId: o.htmlId } : {}),
    layout: "2",
    align: "middle",
    gap: 70,
    style: pad(100, 20, 100),
    background: o.background,
    backgroundFixed: true,
    contentMax: 1000,
    at: { sm: { contentMax: 320, ...(o.listFirst ? { reverse: true } : {}) } },
    columns: o.listFirst ? [list, words] : [words, list],
  };
}

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

function storeManagerPage() {
  const rows = [
    // 1. The hero (6.1, at the owner's 35°).
    {
      id: id(), type: "row", layout: "1", align: "middle", height: 50, style: pad(150, 20, 100), background: HERO_BG, backgroundFixed: true,
      contentMax: 968, typography: { text: { align: "center" } }, at: { sm: { height: 100, style: pad(0, 20, 0) } },
      columns: [{
        id: id(),
        blocks: [
          dual(1, "Kaizena Store Manager", "Run Your Store by Asking", "dark-color"),
          lead("No need to hire.", "Your AI Store Manager answers your questions, builds what you ask for and does the daily work, and it asks before anything that matters."),
          mainAction(),
          textLink("See what it can do", "#manager"),
          checks(["Ask in your own words", "Works toward your goals", "Waits for your yes"], {
            layout: "row", position: "center", gap: 20, typography: { text: { weight: 500 } }, visibility: { hideAt: ["sm"] },
          }),
        ],
      }],
    },
    // 2. What it is, in three cards (6.4). The admin map (D103), ⌘K, reports from code (D346), the autopilot's goals and plans (D309).
    {
      id: id(), type: "row", htmlId: "manager", layout: "1", moreLines: ["3"], gap: 40, style: pad(100, 20, 100), background: TURN_A, backgroundFixed: true,
      contentMax: 1100, equalHeight: true, typography: { text: { align: "center" } }, at: { sm: { contentMax: 320 } },
      columns: [
        {
          id: id(), ...onSand,
          blocks: [
            dual(2, "One assistant", "Your whole admin, one question away", "light-color"),
            lead("Open it beside any page.", "It knows every screen of the admin, works from your store's own figures and does the work you ask for."),
          ],
        },
        card("Ask", "anything", "How did last week go?", "Get the answer in plain words, from your own sales.", ["Sales, customers and stock", "Sums worked out, never guessed", "Any answer kept as a report"]),
        card("Tell", "it what to do", "Add the new products. Start a sale.", "Answer that customer. It prepares it all.", ["Products, prices and pages", "Sales, campaigns and emails", "Orders, returns and exchanges"]),
        card("Leave", "it running", "Give it a goal.", "It makes a plan, works through it and tells you how it went.", ["Goals measured from your figures", "Plans that start on your yes", "A report every week"]),
      ],
    },
    // 3. Figures: sales_trend, customer_insights, product_performance, sales_funnel, restock_suggestions, vat_report and oss_return_data,
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
    // 4. Building: create_product and write_product_texts (drafts, D308), build_page with its pictures (page_ai_jobs), save_menu and
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
    // 5. Marketing: create_discount and create_campaign, draft_broadcast (send_broadcast never automatic), count_segment and tag_customer,
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
    // 6. The day's work: tag_orders, mark_order_sent, resend_order_email, approve_return and decline_return, propose_exchange,
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
    // 7. The autopilot: goals of up to five targets (D309), plans started on a yes or at once (D328), reacting to events (D331),
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
    // 8. You stay in charge: the three levels (LEVEL_WORDS), the areas (AUTONOMY_AREAS), the limits (discount, price change, emails a
    // week) and NEVER_AUTOMATIC as the settings page words it; the activity log's acted_by.
    {
      id: id(), type: "row", layout: "1", moreLines: ["3", "1"], gap: 40, style: pad(100, 20, 100), background: TURN_C, backgroundFixed: true,
      contentMax: 1100, equalHeight: true, typography: { text: { align: "center" } }, at: { sm: { contentMax: 320 } },
      columns: [
        {
          id: id(), ...onSand,
          blocks: [
            dual(2, "You decide", "You stay in charge", "dark-color"),
            lead("Choose how far it goes, area by area:", "products, website, design, store setup, marketing, messages to customers and money."),
          ],
        },
        { id: id(), ...onSand, ...CARD, style: pad(40, 24, 46), blocks: [h3("Ask", "me first"), lead("Every change waits for your yes.", "A card shows exactly what it will do, and you press Approve or Decline.")] },
        { id: id(), ...onSand, ...CARD, style: pad(40, 24, 46), blocks: [h3("Do", "it and tell me"), lead("It makes the change and says what it did,", "so you can look whenever it suits you.")] },
        { id: id(), ...onSand, ...CARD, style: pad(40, 24, 46), blocks: [h3("Just", "do it"), lead("It gets on with it,", "within the limits you set: the deepest discount, the largest price change and how many emails a week.")] },
        {
          id: id(), ...onSand, ...LINED, radius: 10, background: { type: "color", color: "#ffffff", opacity: 24 }, style: pad(20, 30, 30),
          blocks: [lead("Some things always wait for your yes:", "refunds and order changes, emails to your whole list, who works in the store, your domains, your plan and opening the store. Everything it does is in the activity log.")],
        },
      ],
    },
    // 9. Your way: the panel beside the page and ⌘K (D103), voice mode (D104, D105), memory (D103), saved skills and notices (D350), the
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
    // 10. Three highlighted cards: the Dream Factory (D409), web research (D329), brand, look and logo (D330).
    {
      id: id(), type: "row", layout: "3", gap: 40, style: pad(100, 20, 100), background: TURN_C, backgroundFixed: true,
      contentMax: 1100, equalHeight: true, typography: { text: { align: "center" } }, at: { sm: { contentMax: 320 } },
      columns: [
        {
          id: id(), ...onSand, ...CARD, ...LINED, style: pad(36, 24, 40),
          blocks: [
            dual(2, "Dream Factory", "A whole store from one description", "dark-color"),
            lead("Describe your business,", "and it builds the store: products, pages, a look and legal pages, ready for you to open."),
            rich([para({ text: "Dream Factory", href: "/dream-factory" })]),
          ],
        },
        {
          id: id(), ...onSand, ...CARD, ...LINED, style: pad(36, 24, 40),
          blocks: [
            dual(2, "Research", "It looks things up for you", "light-color"),
            lead("It searches the web and reads the pages,", "keeps notes with their sources and compares your options side by side."),
          ],
        },
        {
          id: id(), ...onSand, ...CARD, ...LINED, style: pad(36, 24, 40),
          blocks: [
            dual(2, "Your brand", "A look and a logo of your own", "dark-color"),
            lead("It writes down your brand's voice,", "designs a look with colours that are easy to read and draws your logo from your font."),
          ],
        },
      ],
    },
    // 11. Questions, in a white card (the owner's change on Customer Care).
    {
      id: id(), type: "row", layout: "1", style: pad(100, 20, 100), background: TURN_B, backgroundFixed: true, contentMax: 880, at: { sm: { contentMax: 320 } },
      columns: [{
        id: id(), ...onSand, radius: 6, shadow: "md", background: { type: "color", color: "#ffffff" }, style: pad(30, 30, 40),
        blocks: [
          dual(2, "Good to know", "Your questions, answered", "dark-color", { typography: { text: { color: TEXT, align: "center" }, first: { size: { unit: "px", value: 18 } } } }),
          { id: id(), type: "faq", look: "boxed", single: true, items: faq.map((f) => ({ id: id(), title: f.q, body: doc(para({ text: f.bold, bold: true }, { text: ` ${f.rest}` })) })) },
        ],
      }],
    },
    // 12. The end: the main action (6.7).
    {
      id: id(), type: "row", layout: "1", align: "middle", style: pad(100, 20, 100), background: TURN_A, backgroundFixed: true,
      contentMax: 968, typography: { text: { align: "center" } }, at: { sm: { contentMax: 320 } },
      columns: [{
        id: id(), ...onSand,
        blocks: [
          dual(2, "Ready?", "Meet your AI Store Manager", "light-color"),
          lead("Open your store and ask your first question.", "It is there on every page of the admin."),
          mainAction(),
          textLink("Compare us to others", "/compare"),
        ],
      }],
    },
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

const theme = {
  base: "minimal",
  savedId: null,
  settings: {
    mode: "auto",
    light: { text: "#171717", muted: "#525252", accent: "#171717", border: "#e5e5e5", surface: "#f5f5f4", accentText: "#ffffff", background: "#ffffff" },
    dark: { text: "#ededed", muted: "#a3a3a3", accent: "#ededed", border: "#2e2e2e", surface: "#1c1c1c", accentText: "#0a0a0a", background: "#1c1c1c" },
    fonts: { body: "Inter", heading: "Montserrat" },
    buttons: { style: "filled", corners: "pill" },
    visitorSwitch: false,
  },
};
const styles = [
  { slug: "green-text", kind: "colour", settings: { color: "#557400", weight: 700 }, css: null },
  { slug: "colour", kind: "colour", settings: { color: "#242a60", weight: 700 }, css: null },
] as const;

const OUT = path.join(tmpdir(), "kaizena-site-pages");
mkdirSync(OUT, { recursive: true });

it("builds the Store Manager page as the editor would save it", () => {
  const page = storeManagerPage();
  expect(pageSlugProblem(page.slug)).toBeNull();
  const parsed = pageInput.safeParse(page);
  if (!parsed.success) writeFileSync(path.join(OUT, "store-manager.errors.json"), JSON.stringify(parsed.error.issues, null, 1));
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;
  const sets = themeSetsOf(parseStoreTheme(theme).settings);
  const issues = pageIssues(parsed.data, { theme: { sets }, siteCss: textStylesCss(styles as never) });
  const blocks = parsed.data.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks));
  // The page's words only (texts, headings, labels, questions), never its ids, addresses or colours.
  const said: string[] = [];
  const walk = (v: unknown, k = ""): void => {
    if (typeof v === "string") {
      if (["text", "second", "label", "title", "description"].includes(k)) said.push(inlinePlain(v));
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, k));
    else if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v)) walk(vv, kk);
  };
  walk(parsed.data);
  const claims = findClaims(said.join("\n"));
  writeFileSync(
    path.join(OUT, "store-manager.check.json"),
    JSON.stringify(
      {
        issues: issues.map((i) => [i.rule, i.severity, i.where, i.message, JSON.stringify(blocks.find((b) => b.id === i.blockId) ?? null).slice(0, 100)]),
        blocking: blockingIssues(issues).length,
        claims,
        rows: parsed.data.rows.length,
        blocks: blocks.length,
        seo: [page.seo.title.length, page.seo.description.length],
      },
      null,
      1,
    ),
  );
  writeFileSync(path.join(OUT, "store-manager.page.json"), JSON.stringify(parsed.data));
  expect(blockingIssues(issues)).toEqual([]);
  expect(claims).toEqual([]);
  expect(page.seo.title.length).toBeLessThan(60);
  expect(page.seo.description.length).toBeLessThan(160);
});

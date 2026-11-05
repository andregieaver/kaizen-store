// The comparison pages (kaizen-vs-{platform}), made again on 4 and 5 November 2026 from docs/site-design.md's recipes. One generator, one data
// file per platform (`data/{key}.json`; docs/comparison-pages.md says how to run it): what the page says about the other platform, each line with the address it was read
// on. What it says about Kaizena Flow is LINES below, each line a Full row of docs/parity/rows (or the built part of a Partial one).
// A line whose other side was not read is left out of that platform's table (docs/comparison-pages.md, Rules). Each page is checked as
// savePage() checks it: pageInput, then the page checker with the platform's theme and text styles. Writes `{key}.page.json` and
// `{key}.check.json` to the system's temporary folder (`kaizena-compare`), never into the repository.
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { pageInput, pageSlugProblem } from "@/lib/page-content";
import { pageIssues, themeSetsOf, blockingIssues } from "@/lib/page-a11y";
import { parseStoreTheme } from "@/lib/theme";
import { textStylesCss } from "@/lib/text-styles";
import { findClaims } from "@/lib/claims";
import { inlinePlain } from "@/lib/inline-text";

const id = () => randomUUID();
const SAND = "#908064";
const ICON = "#3a4293";
const TEXT = "#171717";
const PURPLE = "#242a60";

const TURN_A = { type: "gradient", style: "shift", flow: "still", colors: [SAND, "#ededed"] };
const TURN_B = { type: "gradient", style: "shift", flow: "still", angle: 240, colors: [SAND, "#ffffff"] };
const TURN_C = { type: "color", color: SAND, opacity: 9 };
const HERO_BG = { type: "gradient", style: "shift", flow: "still", angle: 215, colors: [SAND, "#ffffff"], opacity: 80 };
const pad = (top: number, side: number, bottom: number) => ({ padding: { top, left: side, right: side, bottom } });
const margin = (top: number, left: number, right: number, bottom: number) => ({ margin: { top, left, right, bottom } });
const onSand = { typography: { text: { color: TEXT } } };

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
const button = (label: string, href: string, align: "left" | "center" = "left") => ({ id: id(), type: "button", label, href, align, style: margin(10, 0, 0, 0) });
const card = (first: string, rest: string, bold: string, words: string) => ({
  id: id(),
  ...onSand,
  radius: 20,
  background: { type: "color", color: SAND, opacity: 6 },
  style: pad(40, 24, 46),
  blocks: [h3(first, rest), lead(bold, words)],
});

// What the table says about Kaizena Flow: one line per topic, each a Full row of docs/parity/rows (the row's id beside it), or the
// built part of a Partial one, worded for Homer.
type LineKey =
  | "invoices" | "omnibus" | "withdrawal" | "gpsr" | "vat" | "vies"
  | "bookings" | "subscriptions" | "bundles" | "b2b" | "stores"
  | "reviews" | "backinstock" | "preorders" | "tiered" | "loyalty" | "referral" | "wishlists" | "email" | "reports"
  | "ai" | "mobilepay" | "carriers";
type Section = "Selling in the EU" | "More ways to sell" | "Growing the shop" | "AI and the Nordics";
const LINES: { key: LineKey; section: Section; label: string; flow: string }[] = [
  // international.legal-invoices-and-credit-notes-for-orders (built, D159), customers.omnibus-30-day-lowest-price-reference,
  // international.eu-withdrawal-function-and-self-service-returns + .withdrawal-exclusions-and-digital-waiver, international.gpsr-safety-information,
  // checkout.oss-and-ioss-support (built, D157, D161), checkout.b2b-vat-id-reverse-charge-exemption (built, D157)
  { key: "invoices", section: "Selling in the EU", label: "Legal invoices and credit notes", flow: "{{check}} Built in, in one gap-free series, as PDF" },
  { key: "omnibus", section: "Selling in the EU", label: "The 30-day reference price on a sale", flow: "{{check}} Built in, shown only on a real reduction" },
  { key: "withdrawal", section: "Selling in the EU", label: "Withdrawal button, with exclusions", flow: "{{check}} Built in, with the 14-day clock, exclusions and the waiver for digital content" },
  { key: "gpsr", section: "Selling in the EU", label: "Product safety details (GPSR)", flow: "{{check}} Built in, shown on the product page" },
  { key: "vat", section: "Selling in the EU", label: "VAT by the buyer's country, OSS and IOSS", flow: "{{check}} Built in, with OSS and IOSS figures for your accountant" },
  { key: "vies", section: "Selling in the EU", label: "A business buyer's VAT number checked", flow: "{{check}} Built in, checked with the EU's VIES before VAT is left off" },
  // platform.bookings-appointments-rentals, catalogue.selling-plans-and-subscriptions, catalogue.bundles,
  // catalogue.b2b-company-accounts + .b2b-catalogs-and-price-lists + checkout.b2b-payment-terms, platform.multi-store-management (plan limits)
  { key: "bookings", section: "More ways to sell", label: "Appointments, stays and rentals", flow: "{{check}} Built in, in the same cart and checkout" },
  { key: "subscriptions", section: "More ways to sell", label: "Subscriptions", flow: "{{check}} Built in; customers pause, skip and change them" },
  { key: "bundles", section: "More ways to sell", label: "Bundles", flow: "{{check}} Built in, with stock counted from the parts" },
  { key: "b2b", section: "More ways to sell", label: "Company accounts, price lists and payment terms", flow: "{{check}} Built in" },
  { key: "stores", section: "More ways to sell", label: "Several stores under one owner", flow: "{{check}} From the Grow plan, in one control center" },
  // customers.product-reviews-and-ugc, .back-in-stock-notifications, catalogue.pre-orders, customers.tiered-and-volume-discounts,
  // .loyalty-and-rewards, .customer-referral-program, .wishlists, .email-marketing-broadcasts-and-lifecycle-automations, analytics.scheduled-report-emails
  { key: "reviews", section: "Growing the shop", label: "Product reviews", flow: "{{check}} Built in, with moderation; verified only for real buyers" },
  { key: "backinstock", section: "Growing the shop", label: "Back-in-stock emails", flow: "{{check}} Built in" },
  { key: "preorders", section: "Growing the shop", label: "Pre-orders with a release date", flow: "{{check}} Built in, with an optional deposit" },
  { key: "tiered", section: "Growing the shop", label: "Tiered and volume discounts", flow: "{{check}} Built in, by quantity or by spend" },
  { key: "loyalty", section: "Growing the shop", label: "Loyalty programme", flow: "{{check}} Built in, with tiers and rewards" },
  { key: "referral", section: "Growing the shop", label: "Refer-a-friend", flow: "{{check}} Built in" },
  { key: "wishlists", section: "Growing the shop", label: "Wishlists", flow: "{{check}} Built in, for guests too" },
  { key: "email", section: "Growing the shop", label: "Email campaigns and automations", flow: "{{check}} Built in, sent only to people who said yes" },
  { key: "reports", section: "Growing the shop", label: "Report emails on a schedule", flow: "{{check}} Built in, daily, weekly or monthly" },
  // D94, D309 (the autopilot, NEVER_AUTOMATIC), checkout.mobilepay, orders.shipping-label-purchase-and-printing + .pickup-points-and-lockers-at-checkout (built parts)
  { key: "ai", section: "AI and the Nordics", label: "An AI assistant in the admin", flow: "{{check}} AI Store Manager: works toward goals you set; refunds and emails to your whole list wait for your yes" },
  { key: "mobilepay", section: "AI and the Nordics", label: "MobilePay at checkout", flow: "{{check}} Built in, for Danish and Finnish shoppers" },
  { key: "carriers", section: "AI and the Nordics", label: "Nordic carriers: labels and pickup points", flow: "{{check}} Labels with Bring, Porterbuddy and Helthjem; pickup points with Bring, PostNord and Helthjem" },
];

type Cell = { text: string; url: string };
type Platform = {
  key: string;
  name: string;
  slug: string;
  title: string;
  seo: { title: string; description: string };
  /** The hero's plain words after its bold lead. */
  heroRest: string;
  /** The other side of each line, read on its own pages; a line left out is not on the page. */
  cells: Partial<Record<LineKey, Cell>>;
  strengthsLead: string;
  strengths: Cell[];
  moving: "shopify" | "woocommerce" | "other";
  /** What the other platform adds features with: "an app or a higher plan", "an extension or a plugin". */
  needs: string;
  faq: { q: string; bold: string; rest: string }[];
  readOn: string;
  /** Where the sources were read when not today (a line read by search excerpt, for instance). */
  sourcesNote?: string;
};

function table(p: Platform) {
  const used = LINES.filter((l) => p.cells[l.key]);
  const rows: string[][] = [["What you get", "Kaizena Flow", p.name]];
  const sections: (string | null)[] = [null];
  let last: string | null = null;
  for (const line of used) {
    rows.push([line.label, line.flow, p.cells[line.key]!.text]);
    sections.push(line.section !== last ? line.section : null);
    last = line.section;
  }
  return {
    block: {
      id: id(),
      type: "table",
      rows,
      header: true,
      rowHeaders: true,
      caption: `Kaizena Flow and ${p.name}, read on ${p.readOn}`,
      headerColor: "#ffffff",
      headerBackground: PURPLE,
      sections,
      sectionColor: TEXT,
      sectionBackground: "#f3f1ec",
      iconColor: ICON,
      fixedHeader: "never",
    },
    used,
  };
}

function sources(p: Platform, used: typeof LINES) {
  const items = [
    ...used.map((l) => ({ label: l.label, url: p.cells[l.key]!.url })),
    ...p.strengths.map((s) => ({ label: s.text, url: s.url })),
  ];
  const list = {
    type: "bulletList",
    content: items.map((i) => ({ type: "listItem", content: [para({ text: `${i.label}: ` }, { text: i.url.replace(/^https?:\/\//, ""), href: i.url })] })),
  };
  return {
    id: id(),
    type: "accordion",
    look: "boxed",
    items: [{ id: id(), title: `Where each line about ${p.name} comes from`, body: doc(list) }],
  };
}

function moving(p: Platform) {
  if (p.moving === "shopify" || p.moving === "woocommerce") {
    const shopify = p.moving === "shopify";
    return {
      eyebrow: `Moving from ${p.name}`,
      title: shopify ? "One button brings it over" : "Keep WordPress if you like",
      lead: lead(
        shopify ? "Connect Shopify, press Copy my shop, then Move my shop." : "Connect WooCommerce, choose what moves, then press Copy my shop.",
        `${p.name} keeps selling until you press Move, and nobody gets an email while you set up.`,
      ),
      list: shopify
        ? ["Products, collections and pictures", "Customers and the email list, only people who said yes", "Past orders, discount codes and gift cards", "Pages, blog posts, menus and your old links"]
        : ["Products, categories, customers and past orders", "Coupons and reviews", "Gift cards, the email list and SEO texts, with our free plugin", "Pages, blog posts and menus, or keep them on WordPress"],
      button: { label: "How moving works", href: `/move-your-store/move-from-${p.key}` },
    };
  }
  return {
    eyebrow: `Moving from ${p.name}`,
    title: "We move it for you, free",
    lead: lead("As part of getting you started, we move your shop for you, free of charge.", "You can also do parts of it yourself:"),
    list: ["Copy any page of your live site into the page builder", "Check your old links and point them to your new shop", "Bring your products in from a spreadsheet"],
    button: { label: "How moving works", href: "/move-your-store" },
  };
}

function comparisonPage(p: Platform) {
  const t = table(p);
  const m = moving(p);
  const rows = [
    // 1. The hero (6.1).
    {
      id: id(), type: "row", layout: "1", align: "middle", height: 50, style: pad(150, 20, 100), background: HERO_BG, backgroundFixed: true,
      contentMax: 968, typography: { text: { align: "center" } }, at: { sm: { height: 100, style: pad(0, 20, 0) } },
      columns: [{
        id: id(),
        blocks: [
          dual(1, "Compare", `Kaizena Flow or ${p.name}?`, "dark-color"),
          lead("Built for how Europe sells.", p.heroRest),
          mainAction(),
          textLink("See the comparison", "#compare"),
          checks(["EU rules built in", "AI that runs the shop", "Data kept in Europe"], { layout: "row", position: "center", gap: 20, typography: { text: { weight: 500 } }, visibility: { hideAt: ["sm"] } }),
        ],
      }],
    },
    // 2. Six reasons, as cards (6.4).
    {
      id: id(), type: "row", layout: "1", moreLines: ["2", "2", "2"], gap: 40, style: pad(100, 20, 100), background: TURN_A, backgroundFixed: true,
      contentMax: 1000, equalHeight: true, typography: { text: { align: "center" } }, at: { sm: { contentMax: 320 } },
      columns: [
        { id: id(), ...onSand, blocks: [dual(2, "Six reasons", "Why shops choose Flow", "light-color"), lead("Each one is something you can try in the admin.", "No extra app to install.")] },
        card("Legal", "EU selling, built in", "VAT, invoices and the withdrawal button are part of Flow.", "VAT follows the buyer's country, with OSS and IOSS figures for your accountant, legal invoices and credit notes, the 30-day reference price on sales and product safety details."),
        card("AI", "that runs the shop", "Your AI Store Manager works from your own numbers.", "It works toward goals you set, and refunds, emails to your whole list and changes to your staff always wait for your yes. Describe your business, and the Dream Factory builds the store."),
        card("Sell", "more than parcels", "Appointments, stays, rentals, subscriptions and bundles share one checkout with your products.", "Sell to businesses with company accounts, price lists and payment terms."),
        card("Grow", "without an app bill", "Reviews, wishlists, loyalty, refer-a-friend, back-in-stock emails, pre-orders, tiered discounts and email campaigns come with Flow.", "Nothing extra to find, pay for or keep up to date."),
        card("Made", "for the Nordics", "Book labels with Bring, Porterbuddy and Helthjem.", "Offer pickup points from Bring, PostNord and Helthjem, and take Klarna and MobilePay at checkout."),
        card("Data", "kept in Europe", "Your store's database and servers are in Dublin.", "Staff sign in in two steps, roles limit what each person sees, every change is in the activity log, and our status page shows how the system is doing."),
      ],
    },
    // 3. Line by line: the table in a white card on sand (6.10).
    {
      id: id(), type: "row", htmlId: "compare", layout: "1", moreLines: ["1"], gap: 30, style: pad(100, 20, 100), background: TURN_B, backgroundFixed: true,
      contentMax: 1000, at: { sm: { contentMax: 390 } },
      columns: [
        {
          id: id(), typography: { text: { align: "center", color: TEXT } },
          blocks: [
            dual(2, "Line by line", `Flow and ${p.name}, side by side`, "dark-color"),
            lead(`Where ${p.name} needs ${p.needs}, the table says so.`, `What we say about ${p.name} comes from its own pages, read on ${p.readOn}. Where we found nothing either way, we left the line out.`),
          ],
        },
        { id: id(), ...onSand, radius: 20, background: { type: "color", color: "#ffffff" }, style: pad(24, 24, 24), at: { sm: { style: pad(12, 8, 12) } }, blocks: [t.block] },
      ],
    },
    // 4. Where the other platform is the better fit (6.3, text beside the list).
    {
      id: id(), type: "row", layout: "2", align: "middle", gap: 70, style: pad(100, 20, 100), background: TURN_A, backgroundFixed: true,
      contentMax: 1000, at: { sm: { contentMax: 320 } },
      columns: [
        { id: id(), ...onSand, width: 40, radius: 20, blocks: [dual(2, "Fair is fair", `Where ${p.name} is the better fit`, "light-color"), lead("Flow is not the right choice for everyone.", p.strengthsLead)] },
        { id: id(), ...onSand, width: 60, at: { sm: { style: margin(-40, 0, 0, 0) } }, blocks: [checks(p.strengths.map((s) => s.text))] },
      ],
    },
    // 5. Moving over (6.3).
    {
      id: id(), type: "row", layout: "2", align: "middle", gap: 70, style: pad(100, 20, 100), background: TURN_B, backgroundFixed: true,
      contentMax: 1000, at: { sm: { contentMax: 320, reverse: true } },
      columns: [
        { id: id(), ...onSand, width: 60, blocks: [checks(m.list)] },
        { id: id(), ...onSand, width: 40, radius: 20, style: pad(40, 0, 40), blocks: [dual(2, m.eyebrow, m.title, "dark-color"), m.lead, button(m.button.label, m.button.href)] },
      ],
    },
    // 6. Questions.
    {
      id: id(), type: "row", layout: "1", style: pad(100, 20, 100), background: TURN_C, backgroundFixed: true, contentMax: 880, at: { sm: { contentMax: 320 } },
      columns: [{
        id: id(),
        blocks: [
          dual(2, "Good to know", "Your questions, answered", "light-color", { typography: { text: { color: TEXT, align: "center" }, first: { size: { unit: "px", value: 18 } } } }),
          { id: id(), type: "faq", look: "boxed", single: true, items: p.faq.map((f) => ({ id: id(), title: f.q, body: doc(para({ text: f.bold, bold: true }, { text: ` ${f.rest}` })) })) },
        ],
      }],
    },
    // 7. The end: the main action (6.7).
    {
      id: id(), type: "row", layout: "1", align: "middle", style: pad(100, 20, 60), background: { ...TURN_B, angle: 215 }, backgroundFixed: true,
      contentMax: 968, typography: { text: { align: "center" } }, at: { sm: { contentMax: 320 } },
      columns: [{
        id: id(), ...onSand,
        blocks: [
          dual(2, "Ready?", "Try Flow with your own products", "dark-color"),
          lead("Start with what you sell today.", `Look around while ${p.name} keeps selling, and move when you are happy.`),
          mainAction(),
          textLink("See all comparisons", "/compare"),
        ],
      }],
    },
    // 8. How we compared, and where each line comes from.
    {
      id: id(), type: "row", layout: "1", style: pad(40, 20, 80), background: { ...TURN_B, angle: 215 }, backgroundFixed: true, contentMax: 880,
      at: { sm: { contentMax: 320 } },
      columns: [{
        id: id(), ...onSand,
        blocks: [
          rich(
            [para(
              { text: "How we compared. ", bold: true },
              { text: `${p.name}'s features, plans and prices change. What this page says about ${p.name} comes from its own help pages, documentation and app listings, read on ${p.readOn}${p.sourcesNote ? ` (${p.sourcesNote})` : ""}. Where we found nothing either way, the line is left out: finding nothing is not proof that something is missing. Seen something that has changed? Tell us and we will correct it.` },
            )],
            { typography: { text: { size: { unit: "px", value: 15 } } } },
          ),
          sources(p, t.used),
        ],
      }],
    },
  ];
  return {
    title: p.title,
    slug: p.slug,
    seo: p.seo,
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

const KEYS = ["shopify", "woocommerce", "wix", "bigcommerce", "shopware", "squarespace"];
const DATA = path.join(__dirname, "data");
const OUT = path.join(tmpdir(), "kaizena-compare");
mkdirSync(OUT, { recursive: true });

it.each(KEYS.filter((k) => existsSync(path.join(DATA, `${k}.json`))))("builds the %s page as the editor would save it", (key) => {
  const p = JSON.parse(readFileSync(path.join(DATA, `${key}.json`), "utf8")) as Platform;
  const page = comparisonPage(p);
  expect(pageSlugProblem(page.slug)).toBeNull();
  const parsed = pageInput.safeParse(page);
  if (!parsed.success) writeFileSync(path.join(OUT, `${key}.errors.json`), JSON.stringify(parsed.error.issues, null, 1));
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;
  const sets = themeSetsOf(parseStoreTheme(theme).settings);
  const issues = pageIssues(parsed.data, { theme: { sets }, siteCss: textStylesCss(styles as never) });
  const blocks = parsed.data.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks));
  // The page's words only (texts, headings, labels, cells, questions), never its ids, addresses or colours.
  const said: string[] = [];
  const walk = (v: unknown, k = ""): void => {
    if (typeof v === "string") {
      if (["text", "second", "label", "title", "caption", "description"].includes(k) || k === "cell") said.push(inlinePlain(v.replace(/\{\{\w+\}\}/g, "")));
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, k === "rows" && Array.isArray(x) ? "cells" : k === "cells" ? "cell" : k));
    else if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v)) walk(vv, kk);
  };
  walk(parsed.data);
  const words = said.join("\n");
  writeFileSync(
    path.join(OUT, `${key}.check.json`),
    JSON.stringify(
      {
        issues: issues.map((i) => [i.rule, i.severity, i.where, i.message, JSON.stringify(blocks.find((b) => b.id === i.blockId) ?? null).slice(0, 100)]),
        blocking: blockingIssues(issues).length,
        claims: findClaims(words),
        lines: table(p).used.length,
        seo: [p.seo.title.length, p.seo.description.length],
      },
      null,
      1,
    ),
  );
  writeFileSync(path.join(OUT, `${key}.page.json`), JSON.stringify(parsed.data));
});

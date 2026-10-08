import { z } from "zod";

import { findClaims, type ClaimFinding } from "./claims";
import { ICONS, type IconName } from "./icons";
import {
  ALT_MAX,
  BUTTON_LABEL_MAX,
  HEADING_MAX,
  ITEM_TITLE_MAX,
  PAGE_SLUG_MAX,
  PAGE_TITLE_MAX,
  ROW_LAYOUTS,
  newPageContent,
  pageSlugFromTitle,
  pageSlugProblem,
  type ButtonBlock,
  type ContentGridBlock,
  type DualButtonBlock,
  type HeadingBlock,
  type HeadingLevel,
  type HeadingSize,
  type ImageBlock,
  type PageBlock,
  type PageColumn,
  type PageContent,
  type PageRow,
  type RichTextBlock,
  type RowLayout,
  type Sides,
  type TextAlign,
} from "./page-content";
import { DESCRIPTION_MAX } from "./seo";
import { textToRichText } from "./simple-rich-text";
import { embedUrl } from "./video-embed";

/**
 * Pages built by the site's AI (D92). The owner talks (or types) to it; it
 * interviews them into a brief, plans the page as sections from a
 * catalogue of designs (`PATTERNS`), writes each section's words, and code
 * turns plan and words into the page builder's rows, columns and blocks,
 * saved as a draft; pictures are made after, one by one, into the draft.
 *
 * Pure: the prompts, what the model's answers must look like, the checks
 * on them and the building. The model never writes the page's own
 * structure: it chooses designs and fills their words, so every page it
 * makes is one the builder could make, and passes `pageInput`.
 *
 * Grounded as the site's other AI: facts come from the site (its pages,
 * products and categories, `SiteFacts`) or from what the owner said; it
 * links only to the site's own addresses; it never writes prices, stock or
 * testimonials (a product grid shows the catalogue's own products and
 * prices, and reviews come only from Google); and every text passes the
 * claims filter.
 */

// ---------------------------------------------------------------------------
// What the AI knows about the site
// ---------------------------------------------------------------------------

/** A step's outcome, as the studio's actions answer. */
export type StudioResult<T> = ({ ok: true } & T) | { ok: false; problem: string };

/** An address on the site a page may link to. */
export type SiteLink = { label: string; href: string };

/** The site as the AI is told of it: all it may rely on besides what the owner says. */
export type SiteFacts = {
  kind: "store" | "kaizen";
  name: string;
  /** The language the page is written in: the site's main one. */
  language: { locale: string; name: string };
  /** What the site says about itself (its search description), if anything. */
  about: string;
  /** A store's buyers: consumers, businesses or both. */
  audience: string | null;
  contact: { email: string | null; address: string | null };
  /** Every address the page may link to: pages, categories, products, the blog, email. */
  links: SiteLink[];
  /** Some of the site's products, in their own words (never prices or stock). */
  products: { title: string; href: string; summary: string }[];
  /** Product categories a product grid can show. */
  productCategories: { id: string; name: string; slug: string }[];
  /** A background for tinted sections where the theme has one colour scheme; null when it follows the visitor's device. */
  tint: string | null;
  can: { pictures: boolean; productGrid: boolean; articleGrid: boolean; googleReviews: boolean };
};

// ---------------------------------------------------------------------------
// The interview
// ---------------------------------------------------------------------------

const line = (max: number) => z.string().trim().max(max).catch("");
const lines = (max: number, count: number) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((values) =>
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().slice(0, max))
        .filter(Boolean)
        .slice(0, count),
    );

/** What the interview learned: the page's purpose and what it must say, in the owner's words where they gave them. */
export const pageBrief = z.object({
  title: line(PAGE_TITLE_MAX),
  purpose: line(1000),
  audience: line(500),
  keyPoints: lines(400, 12),
  /** Facts the owner gave that the page may state: only these, besides the site's. */
  facts: lines(400, 20),
  sections: lines(300, 12),
  callToAction: line(300),
  tone: line(300),
  /** What the pictures should show and look like; "none" for no pictures. */
  pictures: line(500),
});
export type PageBrief = z.infer<typeof pageBrief>;

export const EMPTY_BRIEF: PageBrief = pageBrief.parse({});

/** A turn of the conversation, as the browser keeps it. */
export type StudioMessage = { role: "user" | "assistant"; content: string };
export const MESSAGE_MAX = 4000;
export const HISTORY_MAX = 40;

export const studioMessages = z
  .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(MESSAGE_MAX) }))
  .max(HISTORY_MAX);

export type InterviewReply = { message: string; brief: PageBrief; ready: boolean };

/** The model's answer in the interview; plain words are its message, and the brief stays as it was. */
export function readInterviewReply(reply: string, previous: PageBrief): InterviewReply {
  const json = readJson(reply);
  if (!json) return { message: cleanMessage(reply), brief: previous, ready: false };
  const message = typeof json.message === "string" ? cleanMessage(json.message) : "";
  const brief = json.brief && typeof json.brief === "object" ? pageBrief.parse(json.brief) : previous;
  return { message: message || "Tell me more about the page you want.", brief, ready: json.ready === true };
}

// Control characters other than line breaks are dropped.
const cleanMessage = (text: string) => text.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "").trim().slice(0, MESSAGE_MAX);

// ---------------------------------------------------------------------------
// Designs a page is made of
// ---------------------------------------------------------------------------

/** How many pictures a design takes. */
type PictureNeed = "none" | "one" | "optional" | "several";

type Pattern = {
  label: string;
  /** For the model: what the design is for and looks like. */
  about: string;
  /** For the model: the words to write, in `SectionCopy`'s fields. */
  fields: string;
  variants?: Record<string, string>;
  picture: PictureNeed;
  /** What the site must have for it. */
  needs?: keyof SiteFacts["can"];
  /** Items to write, at least and at most. */
  items?: [number, number];
};

export const PATTERNS = {
  hero: {
    label: "Opening",
    about: "The page's first section: its main heading, a short line under it and the main call to action. Always first, once.",
    fields: "heading (the page's main heading, at most 8 words), text (1 or 2 sentences), buttons (1 or 2)",
    variants: {
      "split-right": "words on the left, a picture on the right",
      "split-left": "a picture on the left, words on the right",
      banner: "a wide picture behind the heading and button (white text on a darkened picture); keep the words short",
      centered: "centred words, no picture",
    },
    picture: "one",
  },
  features: {
    label: "Features",
    about: "What the business offers or why to choose it, as 2 to 6 short points side by side, each a title and a sentence or two.",
    fields: "heading, text (an optional line of introduction), items (2 to 6, each title and text)",
    picture: "none",
    items: [2, 6],
  },
  checklist: {
    label: "Checklist",
    about: "Short lines, each after an icon (a tick, a truck for delivery, a clock…): what is included, how it works, what to expect. With a picture beside it if one fits.",
    fields: "heading, text (optional introduction), items (2 to 8, each text and icon; title left empty)",
    picture: "optional",
    items: [2, 8],
  },
  textImage: {
    label: "Text and picture",
    about: "A heading and a few paragraphs beside a picture: the story, the place, the craft.",
    fields: "heading, text (1 to 3 short paragraphs), buttons (0 or 1)",
    variants: { right: "picture on the right", left: "picture on the left" },
    picture: "one",
  },
  text: {
    label: "Text",
    about: "A heading and longer text: details, terms, a story told in full.",
    fields: "heading, text (paragraphs; lists where they help), buttons (0 or 1)",
    picture: "none",
  },
  steps: {
    label: "Steps",
    about: "How something works, as 2 to 4 numbered steps side by side.",
    fields: "heading, text (optional introduction), items (2 to 4, each title and text)",
    picture: "none",
    items: [2, 4],
  },
  faq: {
    label: "Questions and answers",
    about: "Questions visitors ask, each opening to its answer; also read by search engines as questions and answers.",
    fields: "heading, items (2 to 10, each title as the question and text as the answer)",
    picture: "none",
    items: [2, 10],
  },
  tabs: {
    label: "Tabs",
    about: "Related topics side by side, one shown at a time, such as sizes, care and delivery.",
    fields: "heading (optional), items (2 to 5, each title as the tab's name and text)",
    picture: "none",
    items: [2, 5],
  },
  products: {
    label: "Products",
    about: "The store's own products from its catalogue, with their real pictures and prices, as a grid or a row that scrolls; all products or one category.",
    fields: "heading, text (optional introduction), buttons (0 or 1, such as to all products)",
    picture: "none",
    needs: "productGrid",
  },
  articles: {
    label: "Articles",
    about: "The site's newest blog articles.",
    fields: "heading, text (optional introduction)",
    picture: "none",
    needs: "articleGrid",
  },
  reviews: {
    label: "Google reviews",
    about: "The business's rating and newest reviews on Google, fetched from Google. The only reviews a page may show.",
    fields: "heading, text (optional introduction)",
    picture: "none",
    needs: "googleReviews",
  },
  gallery: {
    label: "Pictures",
    about: "2 to 4 pictures side by side: the place, the products in use, the people at work.",
    fields: "heading (optional), captions (one short line per picture, or empty)",
    picture: "several",
  },
  video: {
    label: "Video",
    about: "A YouTube or Vimeo video the owner gave the address of, with a heading and a line about it. Only with an address the owner gave.",
    fields: "heading, text (a sentence about the video), items left empty",
    picture: "none",
  },
  callToAction: {
    label: "Call to action",
    about: "A closing section: a short heading, a sentence and the buttons that say what to do next.",
    fields: "heading, text (1 sentence), buttons (1 or 2)",
    picture: "none",
  },
} as const satisfies Record<string, Pattern>;

export type PatternKey = keyof typeof PATTERNS;
const PATTERN_KEYS = Object.keys(PATTERNS) as [PatternKey, ...PatternKey[]];

const pattern = (key: PatternKey): Pattern => PATTERNS[key];

/** Designs the site can have: those needing a product grid, articles or Google reviews only where it has them. */
export function availablePatterns(facts: SiteFacts): PatternKey[] {
  return PATTERN_KEYS.filter((key) => {
    const need = pattern(key).needs;
    if (need && !facts.can[need]) return false;
    if (pattern(key).picture === "several" && !facts.can.pictures) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export const PICTURES_MAX = 8;
export const SECTIONS_MAX = 12;
const PICTURE_PROMPT_MAX = 1500;

const planPicture = z.object({
  prompt: z.string().trim().min(10).max(PICTURE_PROMPT_MAX),
  alt: z.string().trim().min(3).max(ALT_MAX),
});
export type PlanPicture = z.infer<typeof planPicture>;

const planSection = z.object({
  pattern: z.enum(PATTERN_KEYS),
  variant: z.string().trim().max(40).optional().catch(undefined),
  name: z.string().trim().min(1).max(80),
  /** What the section says, for the writing and for the owner to check. */
  brief: z.string().trim().max(1500).catch(""),
  tinted: z.boolean().optional().catch(undefined),
  picture: planPicture.optional().catch(undefined),
  pictures: z.array(planPicture).max(4).optional().catch(undefined),
  /** Addresses its buttons go to, from the site's links. */
  links: z.array(z.string().trim().max(500)).max(2).optional().catch(undefined),
  /** A product grid: a category's slug, grid or carousel, how many. */
  category: z.string().trim().max(100).optional().catch(undefined),
  display: z.enum(["grid", "carousel"]).optional().catch(undefined),
  limit: z.number().int().min(2).max(12).optional().catch(undefined),
  /** A video's YouTube or Vimeo address, as the owner gave it. */
  video: z.string().trim().max(500).optional().catch(undefined),
});
export type PlanSection = z.infer<typeof planSection>;

export const pagePlan = z.object({
  title: z.string().trim().min(1).max(PAGE_TITLE_MAX),
  slug: z.string().trim().max(200).catch(""),
  description: z.string().trim().max(DESCRIPTION_MAX).catch(""),
  sections: z
    .array(z.unknown())
    .min(1)
    .transform((values) =>
      values.flatMap((value) => {
        const parsed = planSection.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      }),
    )
    .pipe(z.array(planSection).min(1, "The plan held no section Kaizen knows.").max(SECTIONS_MAX * 2)),
});
export type PagePlan = z.infer<typeof pagePlan>;

/** A plan the model answered, read; null with why when it cannot be. */
export function readPlan(reply: string): { ok: true; plan: PagePlan } | { ok: false; problem: string } {
  const json = readJson(reply);
  if (!json) return { ok: false, problem: "The answer was not JSON." };
  const parsed = pagePlan.safeParse(json);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  return { ok: true, plan: parsed.data };
}

/**
 * The plan as Kaizen will build it, and what was changed to get there, for
 * the owner: designs the site cannot have are left out, one opening only
 * and first, buttons only to the site's own addresses, a video only at an
 * address the owner gave, pictures only where the design and the site's
 * AI take them (at most `PICTURES_MAX`), and tinting only where the theme
 * allows it.
 */
export function checkPlan(plan: PagePlan, facts: SiteFacts, ownerWords: string): { plan: PagePlan; notes: string[] } {
  const notes: string[] = [];
  const allowed = new Set(availablePatterns(facts));
  const hrefs = new Set(facts.links.map((link) => link.href));
  const categories = new Set(facts.productCategories.map((category) => category.slug));
  let pictures = 0;
  const take = (picture: PlanPicture | undefined) => {
    if (!picture || !facts.can.pictures || pictures >= PICTURES_MAX) return undefined;
    pictures += 1;
    return picture;
  };
  const sections: PlanSection[] = [];
  for (const section of plan.sections) {
    const info = pattern(section.pattern);
    if (!allowed.has(section.pattern)) {
      notes.push(`Left out "${section.name}": the site has no ${info.label.toLowerCase()} to show.`);
      continue;
    }
    if (section.pattern === "hero" && sections.some((s) => s.pattern === "hero")) {
      notes.push(`Left out "${section.name}": a page has one opening.`);
      continue;
    }
    const video = section.pattern === "video" ? videoLink(section.video, ownerWords) : null;
    if (section.pattern === "video" && !video) {
      notes.push(`Left out "${section.name}": a video needs a YouTube or Vimeo address you gave.`);
      continue;
    }
    const variants = "variants" in info ? (info.variants as Record<string, string>) : null;
    let variant = variants && section.variant && section.variant in variants ? section.variant : variants ? Object.keys(variants)[0] : undefined;
    const links = (section.links ?? []).filter((href) => {
      if (hrefs.has(href)) return true;
      notes.push(`"${section.name}": left out a link to ${href.slice(0, 80)}, which is not an address on the site.`);
      return false;
    });
    const wantsPicture = info.picture === "one" || info.picture === "optional";
    const picture = wantsPicture && !(section.pattern === "hero" && variant === "centered") ? take(section.picture) : undefined;
    // An opening or a text beside a picture without one is drawn without it.
    if (section.pattern === "hero" && !picture && variant !== "centered") variant = "centered";
    if (section.pattern === "textImage" && !picture) {
      if (facts.can.pictures && section.picture) notes.push(`"${section.name}": at most ${PICTURES_MAX} pictures are made for a page.`);
      sections.push({ ...section, pattern: "text", variant: undefined, picture: undefined, links });
      continue;
    }
    const gallery = info.picture === "several" ? (section.pictures ?? []).map(take).filter((p): p is PlanPicture => Boolean(p)) : undefined;
    if (section.pattern === "gallery" && (gallery?.length ?? 0) < 2) {
      notes.push(`Left out "${section.name}": a gallery needs at least two pictures.`);
      continue;
    }
    const category = section.pattern === "products" && section.category && categories.has(section.category) ? section.category : undefined;
    if (section.pattern === "products" && section.category && !category) {
      notes.push(`"${section.name}": shows all products, as the store has no category "${section.category}".`);
    }
    sections.push({
      ...section,
      variant,
      links,
      picture,
      pictures: gallery,
      category,
      video: video ?? undefined,
      tinted: facts.tint ? section.tinted : undefined,
    });
  }
  // The opening comes first.
  const hero = sections.findIndex((section) => section.pattern === "hero");
  if (hero > 0) sections.unshift(...sections.splice(hero, 1));
  return { plan: { ...plan, sections: sections.slice(0, SECTIONS_MAX) }, notes };
}

/** A YouTube or Vimeo address the owner wrote themselves; null for any other. */
function videoLink(link: string | undefined, ownerWords: string): string | null {
  if (!link) return null;
  const typed = link.trim();
  if (!ownerWords.includes(typed)) return null;
  return embedUrl("youtube", typed) || embedUrl("vimeo", typed) ? typed : null;
}

/** How many pictures a plan will make. */
export const planPictureCount = (plan: PagePlan) =>
  plan.sections.reduce((sum, section) => sum + (section.picture ? 1 : 0) + (section.pictures?.length ?? 0), 0);

// ---------------------------------------------------------------------------
// A section's words
// ---------------------------------------------------------------------------

const ICON_NAMES = Object.keys(ICONS) as [IconName, ...IconName[]];

export const sectionCopy = z.object({
  heading: z.string().trim().max(HEADING_MAX).catch(""),
  text: z.string().trim().max(8000).catch(""),
  items: z
    .array(
      z.object({
        title: z.string().trim().max(ITEM_TITLE_MAX).catch(""),
        text: z.string().trim().max(4000).catch(""),
        icon: z.enum(ICON_NAMES).optional().catch(undefined),
      }),
    )
    .max(12)
    .catch([]),
  buttons: z
    .array(z.object({ label: z.string().trim().max(BUTTON_LABEL_MAX).catch(""), href: z.string().trim().max(500).catch("") }))
    .max(2)
    .catch([]),
  captions: z.array(z.string().trim().max(300).catch("")).max(4).catch([]),
});
export type SectionCopy = z.infer<typeof sectionCopy>;

export const EMPTY_COPY: SectionCopy = { heading: "", text: "", items: [], buttons: [], captions: [] };

/** A section's words as the model answered them; null when it did not answer in JSON. */
export function readCopy(reply: string): SectionCopy | null {
  const json = readJson(reply);
  return json ? sectionCopy.parse(json) : null;
}

/** Every claim the claims filter finds in a section's words, with where. */
export function copyClaims(copy: SectionCopy): (ClaimFinding & { where: string })[] {
  const found: (ClaimFinding & { where: string })[] = [];
  const check = (text: string, where: string) => found.push(...findClaims(text).map((claim) => ({ ...claim, where })));
  check(copy.heading, "heading");
  check(copy.text, "text");
  copy.items.forEach((item, index) => {
    check(item.title, `item ${index + 1}`);
    check(item.text, `item ${index + 1}`);
  });
  copy.buttons.forEach((button, index) => check(button.label, `button ${index + 1}`));
  copy.captions.forEach((caption, index) => check(caption, `caption ${index + 1}`));
  return found;
}

/** A text without the sentences that carry a claim, for words still carrying one after the model was asked again. */
export function withoutClaims(text: string): string {
  if (findClaims(text).length === 0) return text;
  return text
    .split(/\n/)
    .map((paragraph) =>
      (paragraph.match(/[^.!?]+[.!?]*\s*/g) ?? [paragraph])
        .filter((sentence) => findClaims(sentence).length === 0)
        .join("")
        .trim(),
    )
    .join("\n")
    .trim();
}

/** The section's words with every claim taken out. */
export function copyWithoutClaims(copy: SectionCopy): SectionCopy {
  return {
    heading: withoutClaims(copy.heading),
    text: withoutClaims(copy.text),
    items: copy.items.map((item) => ({ ...item, title: withoutClaims(item.title), text: withoutClaims(item.text) })),
    buttons: copy.buttons.map((button) => ({ ...button, label: withoutClaims(button.label) })),
    captions: copy.captions.map(withoutClaims),
  };
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

type Message = { role: "system" | "user" | "assistant"; content: string };

const RULES = [
  "Facts come only from the site's facts below or from what the owner said. Never invent names, numbers, years, awards, certifications, customers, guarantees or opening hours.",
  "Never state prices, discounts, amounts of money, stock, delivery times or promises: the page shows products with their real prices from the store.",
  "Never write reviews, quotes or testimonials: reviews come only from Google.",
  'Never use urgency ("only today", "hurry"), best- or lowest-price claims, or general environmental claims ("sustainable", "eco-friendly", "climate neutral", "green").',
  "Write as the business, to its visitors: clear, warm and concrete; no filler, no clichés, no exclamation marks in headings.",
];

function factsText(facts: SiteFacts): string {
  const site = {
    site: facts.name,
    kind: facts.kind === "store" ? "an online store" : "Kaizen, the platform online stores are built on",
    language: facts.language.name,
    about: facts.about || undefined,
    sellsTo: facts.audience ?? undefined,
    contact: facts.contact.email || facts.contact.address ? facts.contact : undefined,
    products: facts.products.length > 0 ? facts.products.map((product) => `${product.title}: ${product.summary}`) : undefined,
    productCategories: facts.productCategories.length > 0 ? facts.productCategories.map((category) => category.name) : undefined,
  };
  return JSON.stringify(site, null, 1);
}

/** The interview's instructions, then the conversation so far. */
export function interviewMessages(facts: SiteFacts, brief: PageBrief, history: StudioMessage[]): Message[] {
  const system = [
    `You are the web designer and copywriter in ${facts.name}'s admin. The owner wants a new page on the website, and you will plan it, write it and make its pictures with the page builder. First you interview them, briefly, to understand the page.`,
    "",
    "What you know about the site:",
    factsText(facts),
    "",
    "How to interview:",
    "- Reply in the language the owner writes in. Ask one or two short questions at a time; offer choices when that helps them answer.",
    "- Find out: what the page is for and who it is for; the key points it must make, with the facts only the owner knows (what they offer, how they work, what makes them different); what visitors should do next; the tone; what the pictures should show and look like, or whether to have none.",
    `- Pages can have: ${availablePatterns(facts)
      .map((key) => PATTERNS[key].label.toLowerCase())
      .join(", ")}. ${facts.can.pictures ? "Pictures are made by AI to fit the page." : "The site's AI cannot make pictures, so the page will have none."}`,
    "- Never invent facts about the business: what is not in the site's facts must come from the owner. Put every fact the owner gives in the brief's facts.",
    "- Do not ask about prices, stock or reviews: the page never states them (products show their own prices).",
    "- Aim for three to six questions in all. When you know enough to plan the page, say so in one short sentence and set ready to true. If the owner wants you to start, set ready to true.",
    `- The page will be written in ${facts.language.name}.`,
    "",
    "Answer with JSON only, in this form, keeping the brief up to date with everything learned so far:",
    JSON.stringify({ message: "What you say to the owner.", ready: false, brief }),
  ].join("\n");
  return [{ role: "system", content: system }, ...history.map((message) => ({ role: message.role, content: message.content }))];
}

function catalogueText(facts: SiteFacts): string {
  return availablePatterns(facts)
    .map((key) => {
      const info = pattern(key);
      const variants = "variants" in info ? ` Variants: ${Object.entries(info.variants as Record<string, string>).map(([name, about]) => `"${name}" (${about})`).join(", ")}.` : "";
      const pictures =
        info.picture === "one" ? " Takes one picture." : info.picture === "optional" ? " May take one picture." : info.picture === "several" ? " Takes 2 to 4 pictures." : "";
      return `- "${key}": ${info.about}${variants}${facts.can.pictures ? pictures : ""}`;
    })
    .join("\n");
}

function linksText(facts: SiteFacts): string {
  return facts.links.map((link) => `- ${link.href} (${link.label})`).join("\n") || "- (none)";
}

/** The plan's instructions: the brief and the owner's words, and, to change a plan, the plan and what to change. */
export function planMessages(
  facts: SiteFacts,
  brief: PageBrief,
  ownerWords: string,
  change?: { plan: PagePlan; request: string },
): Message[] {
  const example = {
    title: "The page's title",
    slug: "the-address",
    description: "One or two sentences for search engines.",
    sections: [
      {
        pattern: "hero",
        variant: "split-right",
        name: "Opening",
        brief: "What it says, in a sentence or two.",
        links: [facts.links[0]?.href ?? "/"],
        ...(facts.can.pictures ? { picture: { prompt: "A detailed description of the picture to make.", alt: "What the picture shows, in the page's language." } } : {}),
      },
    ],
  };
  const system = [
    `You are the web designer planning a new page for ${facts.name}'s website, built with the page builder from the designs below.`,
    "",
    "What you know about the site:",
    factsText(facts),
    "",
    "Designs a section can have:",
    catalogueText(facts),
    "",
    "Addresses on the site buttons may link to (use them exactly; no others):",
    linksText(facts),
    facts.productCategories.length > 0 ? `\nProduct categories a products section can show (by slug): ${facts.productCategories.map((c) => `${c.slug} (${c.name})`).join(", ")}` : "",
    "",
    "How to plan:",
    "- The first section is the opening (\"hero\"); then 3 to 7 more, in the order a visitor needs them; end with a call to action unless the page is only information.",
    "- Each section: its design, a short name for the owner, and a brief of what it says, specific to this business, from the owner's brief and facts.",
    "- Vary the designs so the page has rhythm; do not repeat one design twice in a row.",
    facts.tint ? '- Set "tinted": true on one or two sections to set them apart with a soft background, never two in a row.' : "",
    facts.can.pictures
      ? `- Pictures: for each picture, "prompt" describes it for an image model in English (the subject, setting, light, style and framing, as a photographer's brief; realistic; no text, letters, logos or brands in it; people only if the brief suits it), and "alt" says what it shows in ${facts.language.name}, in one short sentence. At most ${PICTURES_MAX} in all. Follow the owner's wishes for pictures: ${brief.pictures || "none given"}.`
      : "- There are no pictures: choose designs without them (an opening \"centered\").",
    `- The title and description are in ${facts.language.name}; the slug is the address, lowercase words joined by hyphens.`,
    "- A video section only with a YouTube or Vimeo address the owner gave, in \"video\".",
    "",
    "Answer with JSON only, in this form:",
    JSON.stringify(example),
  ]
    .filter((part) => part !== "")
    .join("\n");
  const user = [
    "The owner's brief:",
    JSON.stringify(brief, null, 1),
    "",
    "What the owner said:",
    ownerWords || "(nothing more)",
    ...(change ? ["", "The current plan:", JSON.stringify(change.plan), "", `Change it as the owner asks: ${change.request}`] : []),
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** The instructions for one section's words. */
export function copyMessages(
  facts: SiteFacts,
  brief: PageBrief,
  plan: PagePlan,
  index: number,
  ownerWords: string,
  retry?: { claims: string[] },
): Message[] {
  const section = plan.sections[index];
  const info = pattern(section.pattern);
  const buttons = section.links?.length ? `Buttons go to ${section.links.join(" and ")}, in that order.` : "No buttons.";
  const system = [
    `You are the copywriter for ${facts.name}'s website, writing one section of a new page in ${facts.language.name}.`,
    "",
    "What you know about the site:",
    factsText(facts),
    "",
    "Rules:",
    ...RULES.map((rule) => `- ${rule}`),
    "- Write only in the section's fields. Text may have paragraphs (a blank line between), lists (lines starting \"- \"), **bold** for a few key words, and links as [words](address) to the site's addresses below.",
    "- Headings are short (at most 8 words); button labels at most 4 words, saying what happens.",
    `- Icons, where items take one, are one of: ${Object.keys(ICONS).join(", ")}.`,
    "",
    "The site's addresses:",
    linksText(facts),
    "",
    'Answer with JSON only: {"heading": "", "text": "", "items": [{"title": "", "text": "", "icon": "check"}], "buttons": [{"label": "", "href": ""}], "captions": []}, filling only the fields the section uses.',
  ].join("\n");
  const user = [
    `The page: ${plan.title}. Its sections: ${plan.sections.map((s, i) => `${i + 1}. ${s.name} (${pattern(s.pattern).label})`).join("; ")}.`,
    `The owner's brief: ${JSON.stringify(brief)}`,
    `What the owner said: ${ownerWords || "(nothing more)"}`,
    "",
    `Write section ${index + 1}, "${section.name}", a ${info.label.toLowerCase()} section: ${info.about}`,
    `Its brief: ${section.brief || "(none: write what fits the page)"}`,
    `Fields: ${info.fields}. ${buttons}`,
    section.pictures?.length ? `It shows ${section.pictures.length} pictures: ${section.pictures.map((p) => p.alt).join("; ")}.` : "",
    section.picture ? `Beside it is a picture: ${section.picture.alt}` : "",
    index === 0 ? "This is the page's main heading." : "Do not repeat what other sections say.",
    `Tone: ${brief.tone || "friendly and clear"}.`,
    ...(retry
      ? ["", `Your last answer had phrases the site may not use: ${retry.claims.join("; ")}. Write it again without them or anything like them.`]
      : []),
  ]
    .filter(Boolean)
    .join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** The picture model's brief: the plan's description, the owner's wishes for pictures, and no words in it. */
export function picturePrompt(picture: PlanPicture, brief: PageBrief): string {
  const style = brief.pictures && brief.pictures.toLowerCase() !== "none" ? ` Style: ${brief.pictures}.` : "";
  return `${picture.prompt}${style} No text, letters, numbers, logos or watermarks anywhere in the picture.`.slice(0, 4000);
}

// ---------------------------------------------------------------------------
// Building the page
// ---------------------------------------------------------------------------

/** Where a made picture goes: a picture block, or a row's background; the first also becomes the page's own picture. */
export type PictureJob = {
  key: string;
  target: { kind: "block"; blockId: string } | { kind: "row"; rowId: string };
  thumbnail: boolean;
  prompt: string;
  alt: string;
  shape: "landscape" | "portrait" | "square";
};

export type BuiltPage = { content: PageContent; pictures: PictureJob[] };

type NewId = () => string;

const CENTER: TextAlign = "center";
const sides = (top: number, bottom: number, x = 20): Sides => ({ top, right: x, bottom, left: x });

type Ctx = { id: NewId; facts: SiteFacts; allowLink: (href: string) => boolean; pictures: PictureJob[] };

/**
 * A row with exactly the columns its layout has, as the page's own check
 * asks: a row short of items (the last of five features in threes) gets
 * empty columns, so its columns keep the others' widths; any more than the
 * layout has go into its last column.
 */
function row(ctx: Ctx, layout: RowLayout, columns: PageBlock[][], extra: Partial<PageRow> = {}): PageRow {
  const count = ROW_LAYOUTS[layout].widths.length;
  const fitted = Array.from({ length: count }, (_, index) => (index < count - 1 ? (columns[index] ?? []) : columns.slice(index).flat()));
  return {
    id: ctx.id(),
    type: "row",
    layout,
    columns: fitted.map((blocks): PageColumn => ({ id: ctx.id(), blocks })),
    ...extra,
  };
}

function heading(ctx: Ctx, text: string, level: HeadingLevel, size: HeadingSize, extra: Partial<HeadingBlock> = {}): HeadingBlock[] {
  const words = text.trim().slice(0, HEADING_MAX);
  return words ? [{ id: ctx.id(), type: "heading", text: words, level, size, ...extra }] : [];
}

function text(ctx: Ctx, words: string, align?: TextAlign): RichTextBlock[] {
  if (!words.trim()) return [];
  return [{ id: ctx.id(), type: "richText", doc: textToRichText(words, ctx.allowLink), ...(align && { align }) }];
}

/** The section's buttons that go to an address on the site: one, two side by side, or none. */
function buttons(ctx: Ctx, copy: SectionCopy, section: PlanSection, align?: TextAlign, look: Partial<ButtonBlock> = {}): PageBlock[] {
  const links = section.links ?? [];
  const usable = copy.buttons
    .map((button, index) => ({ label: button.label.trim(), href: ctx.allowLink(button.href) ? button.href : (links[index] ?? "") }))
    .filter((button) => button.label && ctx.allowLink(button.href))
    .slice(0, 2);
  if (usable.length === 0) return [];
  const size = section.pattern === "hero" ? "lg" : "md";
  if (usable.length === 1) {
    return [{ id: ctx.id(), type: "button", label: usable[0].label, href: usable[0].href, size, ...(align && { align }), ...look }];
  }
  const dual: DualButtonBlock = {
    id: ctx.id(),
    type: "dualButton",
    first: { label: usable[0].label, href: usable[0].href, ...(look.fill && { fill: look.fill }), ...(look.textColor && { textColor: look.textColor }) },
    second: { label: usable[1].label, href: usable[1].href, variant: "outline", ...(look.fill && { fill: look.fill }) },
    size,
    // One under another on phones (D179: stacked at Small).
    at: { sm: { stack: true } },
    ...(align && { align }),
  };
  return [dual];
}

/** An empty picture block the picture will go into, and its job. */
function picture(ctx: Ctx, planned: PlanPicture | undefined, shape: PictureJob["shape"], thumbnail = false, caption = ""): ImageBlock[] {
  if (!planned) return [];
  const block: ImageBlock = { id: ctx.id(), type: "image", image: null, caption: caption.trim().slice(0, 300), shape };
  ctx.pictures.push({ key: block.id, target: { kind: "block", blockId: block.id }, thumbnail, prompt: planned.prompt, alt: planned.alt, shape });
  return [block];
}

/** A section's rows: its design drawn with its words, spaced and aligned alike across the page. */
function sectionRows(ctx: Ctx, section: PlanSection, copy: SectionCopy, first: boolean): PageRow[] {
  const tint = section.tinted && ctx.facts.tint ? { background: { type: "color" as const, color: ctx.facts.tint } } : {};
  const space = (top: number, bottom: number) => ({ style: { padding: sides(top, bottom) } });
  const titled = (align?: TextAlign, size: HeadingSize = "lg") => [
    ...heading(ctx, copy.heading, 2, size, align ? { align } : {}),
    ...text(ctx, copy.text, align),
  ];
  const items = copy.items.filter((item) => item.title.trim() || item.text.trim());

  switch (section.pattern) {
    case "hero": {
      const variant = section.variant ?? "centered";
      if (variant === "banner" && section.picture) {
        const white = "#ffffff";
        const job: PictureJob = { key: ctx.id(), target: { kind: "row", rowId: "" }, thumbnail: true, prompt: section.picture.prompt, alt: section.picture.alt, shape: "landscape" };
        const banner = row(
          ctx,
          "1",
          [
            [
              ...heading(ctx, copy.heading, 1, "2xl", { align: CENTER, textColor: white }),
              // The line under the heading, white as the heading on the darkened picture; a heading's look without a heading's weight.
              ...heading(ctx, copy.text.replace(/\s+/g, " "), 2, "md", { align: CENTER, textColor: white, weight: "normal" }),
              ...buttons(ctx, copy, section, CENTER, { fill: white, textColor: "#111111" }),
            ],
          ],
          { width: "full", ...space(120, 120), align: "middle" },
        );
        job.target = { kind: "row", rowId: banner.id };
        ctx.pictures.push(job);
        return [banner];
      }
      if (variant === "centered" || !section.picture) {
        return [
          row(
            ctx,
            "1",
            [[...heading(ctx, copy.heading, 1, "2xl", { align: CENTER }), ...text(ctx, copy.text, CENTER), ...buttons(ctx, copy, section, CENTER)]],
            { ...space(first ? 72 : 56, 56), ...tint },
          ),
        ];
      }
      // Beside a picture the heading has half the width: a size smaller, so it does not break a word to a line.
      const words = [...heading(ctx, copy.heading, 1, "xl"), ...text(ctx, copy.text), ...buttons(ctx, copy, section)];
      const image = picture(ctx, section.picture, "landscape", true);
      return [
        row(ctx, "2", variant === "split-left" ? [image, words] : [words, image], {
          ...space(first ? 56 : 48, 48),
          align: "middle",
          ...(variant === "split-left" ? { at: { sm: { reverse: true } } } : {}),
          ...tint,
        }),
      ];
    }
    case "features":
    case "steps": {
      const shown = items.slice(0, section.pattern === "steps" ? 4 : 6);
      const perRow = shown.length === 4 ? (section.pattern === "steps" ? 4 : 2) : shown.length <= 3 ? shown.length : 3;
      const layout = String(Math.max(1, perRow)) as RowLayout;
      const rows: PageRow[] = [row(ctx, "1", [titled(CENTER)], { ...space(48, 8), ...tint })];
      for (let start = 0; start < shown.length; start += perRow) {
        const chunk = shown.slice(start, start + perRow);
        rows.push(
          row(
            ctx,
            layout,
            chunk.map((item, index) => [
              ...heading(ctx, section.pattern === "steps" ? `${start + index + 1}. ${item.title}` : item.title, 3, "sm"),
              ...text(ctx, item.text),
            ]),
            { ...space(16, start + perRow >= shown.length ? 48 : 16), ...tint },
          ),
        );
      }
      return rows;
    }
    case "checklist": {
      const list = {
        id: ctx.id(),
        type: "iconList" as const,
        items: items.slice(0, 8).map((item) => ({ id: ctx.id(), icon: item.icon ?? "check", text: (item.text || item.title).slice(0, 300), href: "" })),
      };
      const words = [...titled(), ...(list.items.length > 0 ? [list] : [])];
      const image = picture(ctx, section.picture, "square");
      return [row(ctx, image.length > 0 ? "2" : "1", image.length > 0 ? [words, image] : [words], { ...space(48, 48), align: "middle", ...tint })];
    }
    case "textImage": {
      const words = [...titled(), ...buttons(ctx, copy, section)];
      const image = picture(ctx, section.picture, "landscape");
      return [
        row(ctx, "2", section.variant === "left" ? [image, words] : [words, image], {
          ...space(48, 48),
          align: "middle",
          ...(section.variant === "left" ? { at: { sm: { reverse: true } } } : {}),
          ...tint,
        }),
      ];
    }
    case "text":
      return [row(ctx, "1", [[...titled(), ...buttons(ctx, copy, section)]], { ...space(48, 48), ...tint })];
    case "faq":
    case "tabs": {
      const panels = items.slice(0, section.pattern === "faq" ? 10 : 5).map((item) => ({
        id: ctx.id(),
        title: item.title.slice(0, ITEM_TITLE_MAX),
        body: textToRichText(item.text, ctx.allowLink),
      }));
      const block: PageBlock =
        section.pattern === "faq" ? { id: ctx.id(), type: "faq", items: panels, single: true, look: "lines" } : { id: ctx.id(), type: "tabs", items: panels, look: "underline" };
      return [row(ctx, "1", [[...heading(ctx, copy.heading, 2, "lg", { align: CENTER }), ...text(ctx, copy.text, CENTER), block]], { ...space(48, 48), ...tint })];
    }
    case "products":
    case "articles": {
      const category = section.category ? ctx.facts.productCategories.find((c) => c.slug === section.category) : undefined;
      const grid: ContentGridBlock = {
        id: ctx.id(),
        type: "contentGrid",
        source: section.pattern === "products" ? { type: "products" } : { type: "articles" },
        categories: category ? [category.id] : [],
        tags: [],
        sort: "newest",
        limit: section.limit ?? (section.pattern === "products" ? 8 : 3),
        // Four (three) on computers, three (two) on tablets, two (one) on phones (D179: Extra large, and the smaller sizes' overrides).
        columns: section.pattern === "products" ? 4 : 3,
        at: section.pattern === "products" ? { md: { columns: 3 }, sm: { columns: 2 } } : { md: { columns: 2 }, sm: { columns: 1 } },
        show: { image: true, heading: true, excerpt: section.pattern === "articles", price: section.pattern === "products", button: false },
        buttonLabel: "",
        emptyText: "",
        headingLevel: 3,
        excerptLines: 3,
        gap: 24,
        ...(section.display === "carousel" ? { display: "carousel" as const, peek: true } : {}),
      };
      return [row(ctx, "1", [[...titled(CENTER), grid, ...buttons(ctx, copy, section, CENTER)]], { ...space(48, 48), ...tint })];
    }
    case "reviews":
      return [
        row(
          ctx,
          "1",
          [[...titled(CENTER), { id: ctx.id(), type: "testimonials", source: "google", items: [], ...(section.display === "carousel" ? { display: "carousel" as const } : {}) }]],
          { ...space(48, 48), ...tint },
        ),
      ];
    case "gallery": {
      const shots = section.pictures ?? [];
      const layout = String(Math.min(4, Math.max(2, shots.length))) as RowLayout;
      return [
        ...(copy.heading ? [row(ctx, "1", [heading(ctx, copy.heading, 2, "lg", { align: CENTER })], { ...space(48, 8), ...tint })] : []),
        row(
          ctx,
          layout,
          shots.map((shot, index) => picture(ctx, shot, "square", false, copy.captions[index] ?? "")),
          { ...space(copy.heading ? 16 : 48, 48), ...tint },
        ),
      ];
    }
    case "video": {
      const link = section.video ?? "";
      const source = embedUrl("youtube", link) ? "youtube" : "vimeo";
      return [
        row(
          ctx,
          "1",
          [
            [
              ...titled(CENTER),
              { id: ctx.id(), type: "video", source, video: null, link, poster: null, title: copy.heading.slice(0, 200) },
            ],
          ],
          { ...space(48, 48), ...tint },
        ),
      ];
    }
    case "callToAction":
      return [
        row(ctx, "1", [[...heading(ctx, copy.heading, 2, "lg", { align: CENTER }), ...text(ctx, copy.text, CENTER), ...buttons(ctx, copy, section, CENTER)]], {
          ...space(56, 56),
          ...tint,
        }),
      ];
  }
}

/**
 * The page from its plan and each section's words: rows of the builder's
 * own blocks, pictures left empty with the jobs that fill them, links only
 * to the site's own addresses, a unique address among `takenSlugs`, and
 * the search description. The draft is checked by `pageInput` when saved.
 */
export function buildPage(
  plan: PagePlan,
  copies: SectionCopy[],
  facts: SiteFacts,
  options: { newId: NewId; takenSlugs: readonly string[]; reservedSlugs: readonly string[] },
): BuiltPage {
  const hrefs = new Set(facts.links.map((link) => link.href));
  const ctx: Ctx = { id: options.newId, facts, allowLink: (href) => hrefs.has(href), pictures: [] };
  const rows = plan.sections.flatMap((section, index) => sectionRows(ctx, section, copies[index] ?? EMPTY_COPY, index === 0));
  const title = plan.title.slice(0, PAGE_TITLE_MAX);
  const content: PageContent = {
    ...newPageContent(),
    title,
    slug: uniqueSlug(plan.slug || title, options.takenSlugs, options.reservedSlugs),
    seo: { title: "", description: withoutClaims(plan.description).slice(0, DESCRIPTION_MAX) },
    rows,
  };
  // The first picture is the page's own, for lists and sharing, unless the opening has one.
  if (ctx.pictures.length > 0 && !ctx.pictures.some((job) => job.thumbnail)) ctx.pictures[0].thumbnail = true;
  return { content, pictures: ctx.pictures };
}

/** An address from the plan's (or the title), free among the owner's pages: "om-oss", then "om-oss-2". */
export function uniqueSlug(wanted: string, taken: readonly string[], reserved: readonly string[]): string {
  let base = pageSlugFromTitle(wanted, reserved) || "page";
  if (pageSlugProblem(base, reserved)) base = "page";
  base = base.slice(0, PAGE_SLUG_MAX - 4).replace(/-+$/, "");
  const used = new Set(taken);
  if (!used.has(base) && !reserved.includes(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const next = `${base}-${n}`;
    if (!used.has(next)) return next;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Reading answers
// ---------------------------------------------------------------------------

/** The JSON object in a model's answer (fenced or bare); null when there is none. */
export function readJson(reply: string): Record<string, unknown> | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(reply.slice(start, end + 1));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

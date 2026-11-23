import { contentTexts, tokenProblems } from "./personal-fields";

import { findAvoided, type AvoidedFinding } from "./brand";
import { findClaims, type ClaimFinding } from "./claims";
import type { EmailBlock, EmailContent } from "./email-layout";
import type { BroadcastBlock, BroadcastContent, LanguageContent, SuggestionDraft } from "./broadcasts-schema";

import { SOCIAL_NETWORKS, socialHref } from "./social-links";

export type { BroadcastBlock, BroadcastContent, LanguageContent, SuggestionDraft } from "./broadcasts-schema";

export * from "./broadcast-status";

/**
 * Broadcasts (wave 5 unit C, D297, docs/wave-5-marketing.md 5): an email a store writes once, in its languages, and sends to the addresses on its
 * subscriber list that are `subscribed` (all of them, or a segment's). Pure and shared with the browser: the content's schema, what a send needs,
 * the buttons' click links and the email itself, built from blocks as Kaizena Flow's own emails are (`renderEmail()`).
 */

export const BLOCKS_MAX = 40;
export const SUBJECT_MAX = 150;
export const PREVIEW_MAX = 200;
export const HEADING_MAX = 150;
export const PARAGRAPH_MAX = 3000;
export const BUTTON_MAX = 60;
export const ALT_MAX = 200;
export const ADDRESS_MAX = 500;
/** Profiles in a social links block (M4.1). */
export const SOCIAL_MAX = 8;
/** Cells in a columns block, and the words of one (M4.1). */
export const CELLS_MAX = 3;
export const CELL_TEXT_MAX = 600;
/** Recipients are deleted this long after a send ended, their figures kept on the broadcast (5.6). */
export const RECIPIENTS_KEEP_DAYS = 90;

/** An address a button or picture may link to: a full `https://` address, or a path of the store's own site (written under the recipient's market). */
export function isBroadcastAddress(value: string): boolean {
  if (!value || value.length > ADDRESS_MAX || /\s/.test(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//") && !value.includes("\\");
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export const emptyContent = (): LanguageContent => ({ subject: "", preview: "", blocks: [] });

/** The language a recipient reads: their own when the broadcast has it written, else the main one. */
export function languageFor(content: BroadcastContent, locale: string | null, main: string): string {
  const has = (l: string) => {
    const c = content[l];
    return Boolean(c && c.subject && c.blocks.length > 0);
  };
  if (locale && has(locale)) return locale;
  if (locale) {
    const sameLang = Object.keys(content).find((l) => l.slice(0, 2) === locale.slice(0, 2) && has(l));
    if (sameLang) return sameLang;
  }
  return main;
}

/** Why a broadcast cannot be sent as it is, in words; empty when it can. The audience is checked by the server. */
/** The send checks' words for personal fields (M2.6), said as they are so the admin's catalogue words them (`marketingProblem()`). */
export const PERSONAL_NO_FALLBACK = "Every personal field needs a fallback after a bar, such as {first_name|there}.";
export const PERSONAL_UNKNOWN = "Use only {first_name|…} and {company|…} as personal fields.";

export function sendProblems(content: BroadcastContent, main: string): string[] {
  const problems: string[] = [];
  const mainContent = content[main];
  if (!mainContent?.subject) problems.push("Write a subject in the main language.");
  if (!mainContent || mainContent.blocks.length === 0) problems.push("Add something to say in the main language.");
  for (const [locale, c] of Object.entries(content)) {
    if (locale === main) continue;
    if ((c.subject && c.blocks.length === 0) || (!c.subject && c.blocks.length > 0)) problems.push(`Finish the ${locale} version or empty it: it needs both a subject and something to say.`);
  }
  // Personal fields (M2.6): each with a fallback, and only fields the store has, so no reader gets "Hi ,".
  for (const c of Object.values(content)) {
    for (const problem of contentTexts(c).flatMap(tokenProblems)) {
      const said = problem.kind === "no_fallback" ? PERSONAL_NO_FALLBACK : PERSONAL_UNKNOWN;
      if (!problems.includes(said)) problems.push(said);
    }
  }
  return problems;
}

/** A link's key in the click address: the language and the block's place (`nb-NO.3`), and a column's place in it (`nb-NO.3-1`). */
export const linkKey = (locale: string, index: number, cell?: number) => `${locale}.${index}${cell === undefined ? "" : `-${cell}`}`;

/** The address of the link with this key in the content, or null: the click route redirects only to what the store wrote. */
export function linkTarget(content: BroadcastContent, key: string): string | null {
  const dot = key.lastIndexOf(".");
  if (dot < 1) return null;
  const locale = key.slice(0, dot);
  const place = /^(\d{1,3})(?:-(\d))?$/.exec(key.slice(dot + 1));
  if (!place) return null;
  const block = content[locale]?.blocks[Number(place[1])];
  if (!block) return null;
  if (block.type === "columns") return place[2] === undefined ? null : block.cells[Number(place[2])]?.buttonUrl || null;
  if (place[2] !== undefined) return null;
  if (block.type === "button") return block.url;
  if (block.type === "image") return block.href ?? null;
  if (block.type === "product") return productPath(block.handle);
  return null;
}

/** A product's page in the store, under the recipient's market. */
export const productPath = (handle: string) => `/p/${handle}`;

/** Every link of the content, for the report: its key, words and address. */
export function linksOf(content: BroadcastContent): { key: string; locale: string; label: string; url: string }[] {
  const out: { key: string; locale: string; label: string; url: string }[] = [];
  for (const [locale, c] of Object.entries(content)) {
    c.blocks.forEach((block, index) => {
      if (block.type === "button") out.push({ key: linkKey(locale, index), locale, label: block.text, url: block.url });
      if (block.type === "image" && block.href) out.push({ key: linkKey(locale, index), locale, label: block.alt || "Picture", url: block.href });
      if (block.type === "product") out.push({ key: linkKey(locale, index), locale, label: block.label || block.handle, url: productPath(block.handle) });
      if (block.type === "columns")
        block.cells.forEach((c, cell) => {
          if (c.buttonUrl) out.push({ key: linkKey(locale, index, cell), locale, label: c.buttonText, url: c.buttonUrl });
        });
    });
  }
  return out;
}

/**
 * What code read for one recipient's market and language (D352), by id: a product's title, picture and price lines as the store shows
 * them there, a campaign's offer in the shop's words. Neither is ever written by a model; what is missing here is left out of the email.
 */
export type EmailFacts = {
  products: ReadonlyMap<string, { title: string; image: string | null; alt: string; price: string; small: string[] }>;
  campaigns: ReadonlyMap<string, { title: string; text: string; until: string | null }>;
  /** The words of a product's link ("See the product"), in the recipient's language. */
  linkText: string;
};

/** A product as the writer's `find_products` and the editor's finder hand it: its id, address, title, whether it has a picture, its price as shown. */
export type ProductFact = { id: string; handle: string; title: string; picture: boolean; price: string; summary: string };

/** A running campaign as `running_campaigns` and the editor's finder hand it: its offer in the shop's words, when it ends, what it reaches. */
export type CampaignFact = { id: string; name: string; offer: string; ends: string | null; reaches: string };

/** The editor's finder (D352): products by words and the campaigns running now, read on the server in the store's own country. */
export type FindFacts = (
  storeSlug: string,
  words: string,
) => Promise<{ ok: false; problem: string } | { ok: true; products: ProductFact[]; campaigns: CampaignFact[] }>;

export const NO_FACTS: EmailFacts = { products: new Map(), campaigns: new Map(), linkText: "" };

/** The ids of the products and campaigns a content's blocks name, for the read that draws them. */
export function factIds(content: BroadcastContent): { products: string[]; campaigns: string[] } {
  const blocks = Object.values(content).flatMap((c) => c.blocks);
  return {
    products: [...new Set(blocks.flatMap((b) => (b.type === "product" ? [b.product] : [])))],
    campaigns: [...new Set(blocks.flatMap((b) => (b.type === "campaign" ? [b.campaign] : [])))],
  };
}

export type BuildInput = {
  content: LanguageContent;
  /** The products and campaigns as code read them for this recipient (D352); none, and their blocks are left out. */
  facts?: EmailFacts;
  locale: string;
  footer: string[];
  /** The line under the footer and the unsubscribe link, in the recipient's language. */
  unsubscribe: { text: string; linkText: string; url: string };
  /** An address as it goes in the email: a store path made full under the recipient's market. */
  resolve: (url: string) => string;
  /** The click address for a link; a test passes the target itself. */
  link: (key: string, target: string) => string;
};

/** The email of one language, for `renderEmail()`. */
export function buildBroadcastEmail(input: BuildInput): EmailContent {
  const facts = input.facts ?? NO_FACTS;
  const blocks: EmailBlock[] = input.content.blocks.flatMap((block, index): EmailBlock[] => {
    switch (block.type) {
      case "heading":
      case "paragraph":
        return [{ type: block.type, text: block.text }];
      case "button":
        return [{ type: "button", text: block.text, url: input.link(linkKey(input.locale, index), input.resolve(block.url)) }];
      case "image":
        return [{ type: "image", url: block.url, alt: block.alt, href: block.href ? input.link(linkKey(input.locale, index), input.resolve(block.href)) : null }];
      case "product": {
        const product = facts.products.get(block.product);
        if (!product) return [];
        const url = input.link(linkKey(input.locale, index), input.resolve(productPath(block.handle)));
        return [{ type: "product", ...product, url, linkText: facts.linkText }];
      }
      case "campaign": {
        const campaign = facts.campaigns.get(block.campaign);
        return campaign ? [{ type: "offer", ...campaign }] : [];
      }
      case "divider":
        return [{ type: "divider" }];
      case "columns":
        return [
          {
            type: "columns",
            cells: block.cells.map((c, cell) => ({
              image: c.image ? { url: c.image, alt: c.alt } : null,
              heading: c.heading,
              text: c.text,
              button: c.buttonUrl ? { text: c.buttonText, url: input.link(linkKey(input.locale, index, cell), input.resolve(c.buttonUrl)) } : null,
            })),
          },
        ];
      case "social": {
        // Each profile by its network's name, to the address the owner typed (`socialHref()`); one that is not an address is left out.
        const items = block.links.flatMap((l) => {
          const url = socialHref(l.network, l.url);
          return url ? [{ text: SOCIAL_NETWORKS[l.network], url }] : [];
        });
        return items.length > 0 ? [{ type: "links", items }] : [];
      }
    }
  });
  return {
    subject: input.content.subject,
    preview: input.content.preview || input.content.subject,
    blocks,
    footer: input.footer,
    lang: input.locale.slice(0, 2),
    unsubscribe: input.unsubscribe,
  };
}

// ---------------------------------------------------------------------------
// Written with AI (5.7)
// ---------------------------------------------------------------------------

/**
 * The writer's answer: the words, and (D352) the ids of the products and campaigns it chose among those its tools handed it. Code checks the
 * ids against what was handed (`keepHanded()`) and puts each in as a block; the model never writes a price, a picture or a link.
 */
export type BroadcastSuggestion = {
  subject: string;
  preview: string;
  heading: string;
  paragraphs: string[];
  button: string;
  products: { id: string; handle: string; label: string }[];
  campaigns: { id: string; label: string }[];
};

/** At most this many products and campaigns in one suggestion. */
export const SUGGEST_PRODUCTS_MAX = 6;
export const SUGGEST_CAMPAIGNS_MAX = 2;

/** Subject lines offered to choose from (email plan M3.7). */
export const SUBJECT_CHOICES = 3;

/** The ways an email's words may be rewritten (email plan M3.7), the meaning kept. */
export const REWRITE_TONES = ["shorter", "warmer", "direct"] as const;
export type RewriteTone = (typeof REWRITE_TONES)[number];

/** An email's own words in order, as the rewriter reads them: the subject, then each heading, paragraph and button. */
export function rewritableTexts(content: { subject: string; blocks: readonly BroadcastBlock[] }): string[] {
  return [content.subject, ...content.blocks.flatMap((b) => (b.type === "heading" || b.type === "paragraph" || b.type === "button" ? [b.text] : []))];
}

/**
 * The suggestion with only the products and campaigns the writer's tools handed it (by id, each once, in the model's order, within the
 * limits); an id it made up or took from elsewhere is dropped.
 */
export function keepHanded(
  draft: SuggestionDraft,
  handed: { products: ReadonlyMap<string, { handle: string; title: string }>; campaigns: ReadonlyMap<string, { name: string }> },
): BroadcastSuggestion {
  const products = [...new Set(draft.products)].flatMap((id) => {
    const product = handed.products.get(id);
    return product ? [{ id, handle: product.handle, label: product.title }] : [];
  });
  const campaigns = [...new Set(draft.campaigns)].flatMap((id) => {
    const campaign = handed.campaigns.get(id);
    return campaign ? [{ id, label: campaign.name }] : [];
  });
  const { subject, preview, heading, paragraphs, button } = draft;
  return { subject, preview, heading, paragraphs, button, products: products.slice(0, SUGGEST_PRODUCTS_MAX), campaigns: campaigns.slice(0, SUGGEST_CAMPAIGNS_MAX) };
}

/** The claims a suggestion makes (D76's filter), each with the text it was found in. */
export function suggestionClaims(s: Pick<BroadcastSuggestion, "subject" | "preview" | "heading" | "paragraphs" | "button">, avoid: readonly string[] = []): (ClaimFinding | AvoidedFinding)[] {
  return [s.subject, s.preview, s.heading, ...s.paragraphs, s.button].flatMap((text) => [...findClaims(text), ...findAvoided(text, avoid)]);
}

/**
 * A suggestion as the blocks it fills: the heading, the paragraphs, the campaigns chosen and the products chosen (drawn by code when the
 * email is made) and, when it has words, a button whose address the person adds.
 */
export function suggestionBlocks(s: BroadcastSuggestion): BroadcastBlock[] {
  return [
    { type: "heading", text: s.heading },
    ...s.paragraphs.map((text): BroadcastBlock => ({ type: "paragraph", text })),
    ...(s.campaigns ?? []).map((c): BroadcastBlock => ({ type: "campaign", campaign: c.id, label: c.label })),
    ...(s.products ?? []).map((p): BroadcastBlock => ({ type: "product", product: p.id, handle: p.handle, label: p.label })),
    ...(s.button ? [{ type: "button" as const, text: s.button, url: "/" }] : []),
  ];
}

// ---------------------------------------------------------------------------
// The report (5.6)
// ---------------------------------------------------------------------------

export type BroadcastCounts = {
  recipients: number;
  queued: number;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  failed: number;
  skipped: number;
  unsubscribed: number;
};

export const emptyCounts = (): BroadcastCounts => ({ recipients: 0, queued: 0, sent: 0, delivered: 0, bounced: 0, complained: 0, failed: 0, skipped: 0, unsubscribed: 0 });


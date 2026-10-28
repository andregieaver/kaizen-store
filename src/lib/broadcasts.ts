import { z } from "zod";

import { findAvoided, type AvoidedFinding } from "./brand";
import { findClaims, type ClaimFinding } from "./claims";
import { BROADCAST_AUDIENCES, type BroadcastStatus } from "./broadcast-status";
import type { EmailBlock, EmailContent } from "./email-layout";

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

const address = z.string().trim().refine(isBroadcastAddress, "Write a full address starting with https://, or a path of your store such as /products.");
const words = (max: number, what: string) => z.string().trim().min(1, `${what} is empty.`).max(max, `${what} is longer than ${max} characters.`);

export const broadcastBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: words(HEADING_MAX, "A heading") }),
  z.object({ type: z.literal("paragraph"), text: words(PARAGRAPH_MAX, "A paragraph") }),
  z.object({ type: z.literal("button"), text: words(BUTTON_MAX, "A button's words"), url: address }),
  z.object({
    type: z.literal("image"),
    url: z.string().trim().url("Choose a picture.").max(ADDRESS_MAX),
    alt: z.string().trim().max(ALT_MAX, `A picture's description is longer than ${ALT_MAX} characters.`),
    href: address.nullable().optional(),
  }),
  z.object({ type: z.literal("divider") }),
  // The store's own facts (D352): a product or a running campaign by id, drawn by code for each recipient's market when the email is made
  // (`EmailFacts`); `label` is only what the editor shows. A product links to its page by its address (`/p/{handle}`, which a renamed product
  // redirects); one the market no longer offers, or a campaign that ended, is left out of the email.
  z.object({
    type: z.literal("product"),
    product: z.uuid(),
    handle: z.string().trim().min(1).max(200).regex(/^[a-z0-9-]+$/, "A product's address is lower-case letters, digits and hyphens."),
    label: z.string().trim().max(200).default(""),
  }),
  z.object({ type: z.literal("campaign"), campaign: z.uuid(), label: z.string().trim().max(200).default("") }),
]);
export type BroadcastBlock = z.infer<typeof broadcastBlockSchema>;

export const languageContentSchema = z.object({
  subject: z.string().trim().max(SUBJECT_MAX, `The subject is longer than ${SUBJECT_MAX} characters.`),
  preview: z.string().trim().max(PREVIEW_MAX, `The preview line is longer than ${PREVIEW_MAX} characters.`),
  blocks: z.array(broadcastBlockSchema).max(BLOCKS_MAX, `At most ${BLOCKS_MAX} parts.`),
});
export type LanguageContent = z.infer<typeof languageContentSchema>;

export const broadcastContentSchema = z.record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), languageContentSchema);
export type BroadcastContent = z.infer<typeof broadcastContentSchema>;

export const broadcastInput = z
  .object({
    title: z.string().trim().min(1, "Give it a name.").max(80, "The name is longer than 80 characters."),
    audience: z.enum(BROADCAST_AUDIENCES),
    segmentId: z.uuid().nullable(),
    content: broadcastContentSchema,
  })
  .superRefine((value, ctx) => {
    if (value.audience === "segment" && !value.segmentId) ctx.addIssue({ code: "custom", message: "Choose a segment.", path: ["segmentId"] });
  });
export type BroadcastInput = z.infer<typeof broadcastInput>;

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
export function sendProblems(content: BroadcastContent, main: string): string[] {
  const problems: string[] = [];
  const mainContent = content[main];
  if (!mainContent?.subject) problems.push("Write a subject in the main language.");
  if (!mainContent || mainContent.blocks.length === 0) problems.push("Add something to say in the main language.");
  for (const [locale, c] of Object.entries(content)) {
    if (locale === main) continue;
    if ((c.subject && c.blocks.length === 0) || (!c.subject && c.blocks.length > 0)) problems.push(`Finish the ${locale} version or empty it: it needs both a subject and something to say.`);
  }
  return problems;
}

/** A link's key in the click address: the language and the block's place (`nb-NO.3`). */
export const linkKey = (locale: string, index: number) => `${locale}.${index}`;

/** The address of the link with this key in the content, or null: the click route redirects only to what the store wrote. */
export function linkTarget(content: BroadcastContent, key: string): string | null {
  const dot = key.lastIndexOf(".");
  if (dot < 1) return null;
  const locale = key.slice(0, dot);
  const index = Number(key.slice(dot + 1));
  if (!Number.isInteger(index) || index < 0) return null;
  const block = content[locale]?.blocks[index];
  if (!block) return null;
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

const suggestionSchema = z.object({
  subject: z.string().trim().min(1).max(SUBJECT_MAX),
  preview: z.string().trim().max(PREVIEW_MAX).default(""),
  heading: z.string().trim().min(1).max(HEADING_MAX),
  paragraphs: z.array(z.string().trim().min(1).max(PARAGRAPH_MAX)).min(1).max(4),
  button: z.string().trim().max(BUTTON_MAX).default(""),
  products: z.array(z.string()).max(20).default([]),
  campaigns: z.array(z.string()).max(10).default([]),
});

/** The model's choice, before code keeps only the ids its tools handed it. */
export type SuggestionDraft = z.output<typeof suggestionSchema>;

/** The model's answer read as a suggestion's draft (JSON, possibly in a code fence), or null when it is not one. */
export function parseSuggestion(text: string): SuggestionDraft | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = suggestionSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
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

export const STATUS_WORDS: Record<BroadcastStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  cancelled: "Stopped",
};

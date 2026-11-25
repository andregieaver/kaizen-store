import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { AVOIDED_LABEL, brandGuide } from "@/lib/brand";
import { CLAIM_LABELS } from "@/lib/claims";
import { marketUrl } from "@/lib/paths";
import { postLink } from "@/lib/post-links";
import { RULES_STAND, UNTRUSTED_TEXT } from "@/lib/prompt-safety";
import {
  ANSWER_SHAPE,
  channelBrief,
  copyText,
  newPostRef,
  parseSocialPosts,
  postClaims,
  POST_CHANNELS,
  THEME_MAX,
  TOPIC_MAX,
  type PostChannel,
} from "@/lib/social-posts";

import { AiError, aiFor, chatWithTools, type ToolChatMessage } from "./ai";
import { audit, type Membership } from "./auth";
import { brandOf } from "./brand";
import { priceLines } from "./broadcast-facts";
import { listGridProducts } from "./catalog";
import { memberCan, NO_ACCESS } from "./permissions";
import { col, typedRows } from "./typed-rows";

/**
 * The social post creator (D870 C1, `docs/social-manager.md` 3): the store's writer makes a post per channel from a product's facts or the
 * owner's topic, in the store's main language and brand; code adds the price line (the shop's price in its main market, never the model's)
 * and the tagged link (`postLink()`, one reference for the batch, so each channel's visits and orders are the post's). Every caption and
 * hashtag passes the claims filter and the brand's words to avoid before anything is kept. The owner copies the posts by hand.
 */

/** The language a writer is told to write in, by a locale's first two letters. */
export const LANGUAGE_NAMES: Record<string, string> = { nb: "Norwegian (Bokmål)", nn: "Norwegian (Nynorsk)", sv: "Swedish", da: "Danish", en: "English", de: "German", fi: "Finnish", fr: "French", nl: "Dutch", es: "Spanish", it: "Italian", pl: "Polish" };

const writeInput = z
  .object({
    productId: z.uuid().nullable().default(null),
    pageId: z.uuid().nullable().default(null),
    topic: z.string().trim().max(TOPIC_MAX).default(""),
    campaign: z.string().trim().max(THEME_MAX).default(""),
    channels: z.array(z.enum(POST_CHANNELS)).min(1, "Choose at least one channel.").max(POST_CHANNELS.length),
    withPrice: z.boolean().default(true),
  })
  .refine((v) => v.productId !== null || v.pageId !== null || v.topic.length >= 5, { message: "Choose a product or a page, or say in a few words what the post is about." })
  .refine((v) => v.productId === null || v.pageId === null, { message: "Choose a product or a page, not both." });

export type SocialPost = {
  id: string;
  channel: PostChannel;
  ref: string;
  productId: string | null;
  pageId: string | null;
  topic: string;
  title: string;
  caption: string;
  hashtags: string[];
  link: string;
  priceLine: string | null;
  copiedAt: string | null;
  createdAt: string;
  /** What the owner copies (`copyText()`). */
  text: string;
};

export type WriteResult = { ok: true; posts: SocialPost[] } | { ok: false; problem: string };

type ProductFacts = { id: string; title: string; summary: string; price: string; address: string };

const PAGE_ROW = z.object({ id: col.uuid, slug: col.text, title: col.text, about: col.text, front: col.bool });

/**
 * The store's published pages the creator offers to write about (C1b: Kaizena Flow's own site is its house store's pages, with no products),
 * the front page first, then the newest; each with what search engines are told it is about.
 */
export async function socialPages(store: Membership["store"]): Promise<{ id: string; title: string }[]> {
  return (await pageRows(store.id, null)).map((p) => ({ id: p.id, title: p.title }));
}

async function pageRows(storeId: string, pageId: string | null) {
  return typedRows(
    PAGE_ROW,
    sql`
    select p.id, p.slug, coalesce(nullif(p.published ->> 'title', ''), p.slug) as title,
      coalesce(nullif(p.published -> 'seo' ->> 'description', ''), nullif(p.published -> 'seo' ->> 'title', ''), '') as about,
      (s.front_page_id is not distinct from p.id) as front
    from commerce.pages p join commerce.stores s on s.id = p.store_id
    where p.store_id = ${storeId}::uuid and p.type = 'page' and p.published is not null
      and (${pageId}::uuid is null or p.id = ${pageId}::uuid)
    order by (s.front_page_id is not distinct from p.id) desc, p.updated_at desc, p.id
    limit 48
  `,
  );
}

async function pageFacts(store: Membership["store"], pageId: string): Promise<{ id: string; title: string; summary: string; address: string } | null> {
  const market = store.markets[0];
  const [page] = await pageRows(store.id, pageId);
  if (!page || !market) return null;
  return { id: page.id, title: page.title, summary: page.about.slice(0, 600), address: marketUrl(store.slug, market.code.toLowerCase(), page.front ? "" : `/${page.slug}`) };
}

/** The products the creator offers to write about: the newest the shop offers in its main market, with a price there. */
export async function socialProducts(store: Membership["store"]): Promise<{ id: string; title: string }[]> {
  const market = store.markets[0];
  if (!market) return [];
  const products = await listGridProducts(store.id, market, { categoryIds: [], tagIds: [], sort: "newest", limit: 48 });
  return products.map((p) => ({ id: p.id, title: p.title }));
}

async function productFacts(store: Membership["store"], productId: string): Promise<ProductFacts | null> {
  const market = store.markets[0];
  if (!market) return null;
  const [p] = await listGridProducts(store.id, market, { categoryIds: [], tagIds: [], sort: "given", limit: 1, ids: [productId] });
  if (!p) return null;
  return {
    id: p.id,
    title: p.title,
    summary: (p.excerpt || p.description).replace(/\s+/g, " ").trim().slice(0, 600),
    price: priceLines(p, market).price,
    address: marketUrl(store.slug, market.code.toLowerCase(), `/p/${p.handle}`),
  };
}

export async function writeSocialPosts(member: Membership, raw: unknown, options: { complete?: typeof chatWithTools; ref?: string } = {}): Promise<WriteResult> {
  if (!memberCan(member, "marketing:write")) return { ok: false, problem: NO_ACCESS };
  const parsed = writeInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Check what the post is about." };
  const input = parsed.data;
  const { store } = member;
  const market = store.markets[0];
  if (!market) return { ok: false, problem: "The shop sells in no country yet." };
  const product = input.productId ? await productFacts(store, input.productId) : null;
  if (input.productId && !product) return { ok: false, problem: "That product is not on sale in the shop's main country." };
  const page = input.pageId ? await pageFacts(store, input.pageId) : null;
  if (input.pageId && !page) return { ok: false, problem: "That page is not published on the site." };
  const connection = await aiFor(store.id, { feature: "social_posts", accountId: member.account.id });
  if (!connection?.textModel) return { ok: false, problem: "No AI with a text model is set up for this store." };

  const locale = store.localization.locales[0] ?? market.locale;
  const language = LANGUAGE_NAMES[locale.slice(0, 2)] ?? locale;
  const brand = await brandOf(store.id);
  const guide = brandGuide(brand);
  const channels = POST_CHANNELS.filter((c) => input.channels.includes(c));
  const facts = product
    ? `<product>${JSON.stringify({ title: product.title, about: product.summary })}</product>`
    : page
      ? `<page>${JSON.stringify({ title: page.title, about: page.summary })}</page>`
      : "";
  const topic = input.topic ? `<staff-words>${input.topic.replace(/</g, "‹")}</staff-words>` : "";
  const messages: ToolChatMessage[] = [
    {
      role: "system",
      content: [
        `You write social media posts for the shop "${store.name}", in ${language}, one for each channel asked for.`,
        product
          ? "Each post is about the product given: write only from its title and description and what the shop's staff add."
          : page
            ? "Each post invites people to the page of the shop's site given: write only from its title and description and what the shop's staff add."
            : "Write only from what the shop's staff say the post is about.",
        "Never write a price, a discount, an amount off, a stock level, a delivery time or a link: the shop adds its price and link itself. Never name a product or an offer you were not given.",
        "No urgency or scarcity (no 'only today', 'last chance', 'few left'), no best or lowest price claims, no environmental claims such as sustainable or eco-friendly.",
        RULES_STAND,
        UNTRUSTED_TEXT,
        `The channels and how each reads:\n${channelBrief(channels)}`,
        input.campaign ? `The posts belong to the shop's theme "${input.campaign.replace(/["<]/g, "")}".` : "",
        ANSWER_SHAPE,
        ...(guide ? [`\n\n${guide}`] : []),
      ]
        .filter(Boolean)
        .join(" "),
    },
    { role: "user", content: [facts, topic].filter(Boolean).join("\n") },
  ];
  const chat = options.complete ?? chatWithTools;
  let written;
  try {
    const reply = await chat(connection, messages, [], { maxTokens: 400 + 500 * channels.length, timeoutMs: 60_000 });
    written = parseSocialPosts(reply.content ?? "", channels);
  } catch (error) {
    if (error instanceof AiError) return { ok: false, problem: "The AI did not answer. Try again in a moment." };
    throw error;
  }
  if (!written) return { ok: false, problem: "The AI did not answer with posts. Try again." };
  const claims = written.flatMap((p) => postClaims(p, brand.avoid));
  if (claims.length > 0) {
    const found = [...new Set(claims.map((c) => `${(c.kind === "avoided" ? AVOIDED_LABEL : CLAIM_LABELS[c.kind]).toLowerCase()} ("${c.phrase}")`))].join(", ");
    return { ok: false, problem: `The posts made claims we do not let AI make: ${found}. Try again.` };
  }

  const ref = options.ref ?? newPostRef();
  const address = product?.address ?? page?.address ?? marketUrl(store.slug, market.code.toLowerCase(), "");
  const own = [new URL(address).origin];
  const priceLine = product && input.withPrice && product.price ? `${product.title} · ${product.price}` : null;
  const rows = written.map((post) => {
    const link = postLink({ address, channel: post.channel, post: ref, campaign: input.campaign }, own);
    if (!link) throw new Error(`social post link refused for ${post.channel}`);
    return { ...post, link: link.url };
  });
  const saved = await db().transaction(async (tx) => {
    const kept: { id: string; channel: string }[] = [];
    for (const row of rows) {
      const [r] = await typedRows(
        SAVED_ROW,
        sql`
        insert into commerce.social_posts (store_id, channel, ref, product_id, page_id, topic, campaign, locale, title, caption, hashtags, link, price_line, created_by)
        values (${store.id}::uuid, ${row.channel}, ${ref}, ${product?.id ?? null}::uuid, ${page?.id ?? null}::uuid, ${input.topic}, ${input.campaign}, ${locale}, ${row.title}, ${row.caption},
          ${`{${row.hashtags.join(",")}}`}::text[], ${row.link}, ${priceLine}, ${member.account.id}::uuid)
        returning id, channel
      `,
        tx,
      );
      kept.push(r);
    }
    return kept;
  });
  const idOf = new Map(saved.map((r) => [r.channel, r.id]));
  await audit(member.account.id, store.id, "store.social_posts_written", { ref, channels, product: product?.id ?? null });
  const now = new Date().toISOString();
  return {
    ok: true,
    posts: rows.map((row) => ({
      id: idOf.get(row.channel)!,
      channel: row.channel,
      ref,
      productId: product?.id ?? null,
      pageId: page?.id ?? null,
      topic: input.topic,
      title: row.title,
      caption: row.caption,
      hashtags: row.hashtags,
      link: row.link,
      priceLine,
      copiedAt: null,
      createdAt: now,
      text: copyText({ ...row, priceLine }),
    })),
  };
}

const SAVED_ROW = z.object({ id: col.uuid, channel: col.text });

const POST_ROW = z.object({
  id: col.uuid,
  channel: z.enum(POST_CHANNELS),
  ref: col.text,
  product_id: z.string().nullable(),
  page_id: z.string().nullable(),
  topic: col.text,
  title: col.text,
  caption: col.text,
  hashtags: z.array(z.string()),
  link: col.text,
  price_line: col.textOrNull,
  copied_at: col.timestampOrNull,
  created_at: col.timestamp,
});

/** The store's posts, newest first (at most `limit`), each with the text to copy. */
export async function listSocialPosts(storeId: string, limit = 60): Promise<SocialPost[]> {
  const rows = await typedRows(
    POST_ROW,
    sql`
    select id, channel, ref, product_id, page_id, topic, title, caption, hashtags, link, price_line, copied_at, created_at
    from commerce.social_posts where store_id = ${storeId}::uuid
    order by created_at desc, ref, channel limit ${limit}
  `,
  );
  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    ref: r.ref,
    productId: r.product_id,
    pageId: r.page_id,
    topic: r.topic,
    title: r.title,
    caption: r.caption,
    hashtags: r.hashtags,
    link: r.link,
    priceLine: r.price_line,
    copiedAt: r.copied_at,
    createdAt: r.created_at,
    text: copyText({ channel: r.channel, title: r.title, caption: r.caption, hashtags: r.hashtags, link: r.link, priceLine: r.price_line }),
  }));
}

/** Notes the first time the owner copied a post. Answers whether the post is the store's. */
export async function markSocialPostCopied(member: Membership, id: string): Promise<boolean> {
  if (!memberCan(member, "marketing:write") || !z.uuid().safeParse(id).success) return false;
  const rows = await db().execute(sql`
    update commerce.social_posts set copied_at = coalesce(copied_at, now()) where store_id = ${member.store.id}::uuid and id = ${id}::uuid returning id
  `);
  return rows.length > 0;
}

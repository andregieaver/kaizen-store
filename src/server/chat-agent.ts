import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import {
  chatAgentInput,
  cleanReply,
  kaizenTools,
  navigateArgs,
  returnFacts,
  SHOP_DESTINATIONS,
  SHOP_TOOLS,
  storeTools,
  systemPrompt,
  type ChatAction,
  type ChatProduct,
  type ChatReply,
  type ChatRequest,
} from "@/lib/chat";
import { chatDetails } from "@/lib/custom-fields";
import { featureOn } from "@/lib/store-features";
import { cardNotices, noticesFor, noticeText, type CampaignNotice, type CampaignNotices } from "@/lib/campaign-notices";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { marketPath } from "@/lib/paths";
import type { PriceView } from "@/lib/pricing";
import { priceUnitSentence } from "@/lib/unit-price-text";

import { AI_TAG, AiError, aiFor, canSpeak, chatWithTools, type AiConnection, type ToolChatMessage } from "./ai";
import { audit, type Account } from "./auth";
import { campaignNotices } from "./campaign-notices";
import { getProduct, getVariantStock, type GridProduct } from "./catalog";
import { UNLIMITED, availabilityOf, type VariantStock } from "@/lib/stock-availability";
import { searchKnowledge } from "./knowledge";
import { publishedPageNames } from "./pages";
import { getPlatformChrome } from "./platform-navigation";
import { queryVector } from "./query-vector";
import { recommendForChat } from "./recommend";
import { searchProducts } from "./search";
import { getShippingFacts } from "./seo";
import type { Store } from "./stores";
import { siteTerms } from "./taxonomy";

type Row = Record<string, unknown>;

/**
 * The chat agent (D81): Kaizen's or a store's, answering visitors from the
 * site's own facts through tools, and opening pages for them. The model
 * only words the answers and chooses tools; every product, price, stock
 * level and page comes from Kaizen's own reads, and what is shown is
 * cleaned (`cleanReply`). Conversations are not kept: the visitor's
 * browser holds them and sends them with each question.
 */

export type ChatAgent = {
  storeId: string | null;
  enabled: boolean;
  name: string;
  occupation: string;
  avatar: { url: string; width: number; height: number } | null;
  greeting: Record<string, string>;
  instructions: string;
  voice: boolean;
  dailyLimit: number;
};

export const chatTag = (storeId: string | null) => (storeId ? `chat:${storeId}` : "chat:kaizen");

const owned = (storeId: string | null) => (storeId ? sql`store_id = ${storeId}::uuid` : sql`store_id is null`);

function toAgent(row: Row): ChatAgent {
  return {
    storeId: row.store_id ? String(row.store_id) : null,
    enabled: Boolean(row.enabled),
    name: String(row.name),
    occupation: String(row.occupation),
    avatar: (row.avatar as ChatAgent["avatar"]) ?? null,
    greeting: (row.greeting as Record<string, string>) ?? {},
    instructions: String(row.instructions),
    voice: Boolean(row.voice),
    dailyLimit: Number(row.daily_limit),
  };
}

/** A site's agent as saved, or null; cached for the site's pages. */
export async function getChatAgent(storeId: string | null): Promise<ChatAgent | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(chatTag(storeId));
  const [row] = await readDb().execute<Row>(sql`select * from commerce.chat_agents where ${owned(storeId)}`);
  return row ? toAgent(row) : null;
}

/** The same for the admin, per request. */
export async function getChatAgentForEdit(storeId: string | null): Promise<ChatAgent | null> {
  const [row] = await db().execute<Row>(sql`select * from commerce.chat_agents where ${owned(storeId)}`);
  return row ? toAgent(row) : null;
}

/** What the site's pages show of its agent: who it is, how it greets, and whether it listens and speaks. */
export type ChatWidgetProfile = {
  name: string;
  occupation: string;
  avatar: ChatAgent["avatar"];
  greeting: Record<string, string>;
  voice: boolean;
};

/**
 * The widget for a site's pages, or null while its agent is off or it has
 * no text model; cached with the agent and the site's AI settings.
 */
export async function chatWidgetFor(storeId: string | null): Promise<ChatWidgetProfile | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(chatTag(storeId), AI_TAG);
  const [agent, connection] = await Promise.all([getChatAgent(storeId), aiFor(storeId)]);
  if (!agent?.enabled || !connection?.textModel) return null;
  return {
    name: agent.name,
    occupation: agent.occupation,
    avatar: agent.avatar,
    greeting: agent.greeting,
    voice: agent.voice && canSpeak(connection),
  };
}

export type SaveAgentResult = { ok: true } | { ok: false; problems: string[] };

export async function saveChatAgent(account: Account, storeId: string | null, raw: unknown): Promise<SaveAgentResult> {
  const parsed = chatAgentInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((issue) => issue.message))] };
  const agent = parsed.data;
  const greeting = Object.fromEntries(Object.entries(agent.greeting).filter(([, text]) => text));
  await db().execute(sql`
    insert into commerce.chat_agents (store_id, enabled, name, occupation, avatar, greeting, instructions, voice, daily_limit, updated_by)
    values (${storeId}::uuid, ${agent.enabled}, ${agent.name}, ${agent.occupation}, ${agent.avatar ? JSON.stringify(agent.avatar) : null}::jsonb,
      ${JSON.stringify(greeting)}::jsonb, ${agent.instructions}, ${agent.voice}, ${agent.dailyLimit}, ${account.id}::uuid)
    on conflict (store_id) do update set
      enabled = excluded.enabled, name = excluded.name, occupation = excluded.occupation, avatar = excluded.avatar,
      greeting = excluded.greeting, instructions = excluded.instructions, voice = excluded.voice,
      daily_limit = excluded.daily_limit, updated_at = now(), updated_by = excluded.updated_by
  `);
  await audit(account.id, storeId, "chat.agent_saved", { enabled: agent.enabled, name: agent.name, voice: agent.voice, dailyLimit: agent.dailyLimit });
  return { ok: true };
}

// Limits ------------------------------------------------------------------------

/** A visitor's messages per ten minutes. */
export const VISITOR_LIMIT = 30;

/** A visitor as the limits know them: a hash of their address, changing daily, so it names no one. */
export function visitorKey(address: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${address}|${day}|kaizen-chat`).digest("hex").slice(0, 32);
}

/** Counts a visitor's message, unless they or the site are past their limit: `busy` (the visitor) or `closed` (the site, for today). */
export async function takeChatTurn(storeId: string | null, visitor: string, dailyLimit: number): Promise<"ok" | "busy" | "closed"> {
  const count = async (bucket: string, window: ReturnType<typeof sql>) => {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count)
      values (${storeId}::uuid, ${bucket}, ${window}, 1)
      on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
      returning count
    `);
    return Number(row.count);
  };
  if ((await count(`v:${visitor}`, sql`date_bin('10 minutes', now(), '2000-01-01')`)) > VISITOR_LIMIT) return "busy";
  if ((await count("day", sql`date_trunc('day', now())`)) > dailyLimit) return "closed";
  return "ok";
}

/** Forgets counts older than two days (the five-minute cron). */
export async function pruneChatUsage(): Promise<number> {
  const rows = await db().execute<Row>(sql`delete from commerce.chat_usage where "window" < now() - interval '2 days' returning 1`);
  return rows.length;
}

// The conversation ----------------------------------------------------------------

/** Where the agent talks: a store in one of its countries, or Kaizen's site. */
export type ChatSite = { kind: "store"; store: Store; market: Market } | { kind: "kaizen" };

/** Rounds of tools before the model must answer. */
const ROUNDS = 4;

/** A price as a sentence, the way the store shows it (B2B: with or without VAT, or both). */
function priceText(price: PriceView, locale: string, lang: string, from: boolean): string {
  const m = t(lang);
  const amount = (minor: number) => formatMoney(minor, price.currency, locale);
  const excl = Math.round(price.amountMinor / (1 + price.vat.rate));
  const shown =
    price.vat.shown === "excl"
      ? `${amount(excl)} ${m.vatExcluded}`
      : price.vat.shown === "choice"
        ? `${amount(price.amountMinor)} ${m.vatIncluded} (${amount(excl)} ${m.vatExcluded})`
        : `${amount(price.amountMinor)} ${m.vatIncluded}`;
  // The price per kg, litre or metre (D160), worked out in code from this price: the model repeats it and computes nothing.
  const unit = priceUnitSentence(price, locale, m);
  return `${from ? `${m.fromPrice} ` : ""}${shown}${unit ? ` (${unit})` : ""}`;
}

/** What the store's campaigns offer on a product, as the site words it (D115): the model repeats these and states no offer of its own. */
function offersOn(site: Extract<ChatSite, { kind: "store" }>, notices: CampaignNotices, productId: string, { gifts }: { gifts: boolean }): { card: string[]; told: string[] } {
  const { market } = site;
  const m = t(market.lang);
  const money = (minor: number) => formatMoney(minor, market.currency, market.locale);
  const mine = noticesFor(notices, productId);
  const say = (n: CampaignNotice) => `${n.name}: ${noticeText(n, m, money)}${n.signIn ? ` (${m.campaigns.signIn})` : ""}`;
  return { card: cardNotices(mine).map((n) => noticeText(n, m, money)), told: mine.filter((n) => gifts || n.kind !== "gift").map(say) };
}

function card(site: Extract<ChatSite, { kind: "store" }>, product: Pick<GridProduct, "handle" | "title" | "image" | "price">, from: boolean, offers: string[] = []): ChatProduct {
  return {
    handle: product.handle,
    title: product.title,
    href: marketPath(site.store.slug, site.market.slug, `/p/${product.handle}`),
    image: product.image,
    price: { amountMinor: product.price.amountMinor, currency: product.price.currency, referenceMinor: product.price.referenceMinor, vat: product.price.vat, measure: product.price.measure },
    from,
    ...(offers.length > 0 && { offers }),
  };
}

const json = (value: unknown) => JSON.stringify(value).slice(0, 6000);

type ToolOutcome = { result: string; action?: ChatAction; products?: ChatProduct[] };

async function storeTool(site: Extract<ChatSite, { kind: "store" }>, name: string, args: Record<string, unknown>, request: ChatRequest): Promise<ToolOutcome> {
  const { store, market } = site;
  const text = (key: string) => (typeof args[key] === "string" ? String(args[key]).trim().slice(0, 200) : "");
  // A website (D178 step 5: the online shop off) answers from its pages and knowledge only, whatever a model asks.
  const selling = featureOn(store, "shop");
  if (!selling && (SHOP_TOOLS as readonly string[]).includes(name)) return { result: json({ error: "This store does not sell online." }) };
  switch (name) {
    case "search_products": {
      const query = text("query");
      if (!query) return { result: json({ error: "Say what to look for." }) };
      const [found, notices] = await Promise.all([searchProducts({ storeId: store.id, market }, query, queryVector, null, 6), campaignNotices(store.id, market)]);
      const offers = new Map(found.products.map((p) => [p.id, offersOn(site, notices, p.id, { gifts: false })] as const));
      const products = found.products.map((p) => card(site, p, p.priceVaries, offers.get(p.id)?.card));
      return {
        result: json({
          products: found.products.map((p) => {
            const told = offers.get(p.id)?.told ?? [];
            return { handle: p.handle, title: p.title, price: priceText(p.price, market.locale, market.lang, p.priceVaries), ...(told.length > 0 && { offers: told }) };
          }),
          ...(found.products.length === 0 ? { note: "Nothing found. Try other words, or say so." } : {}),
        }),
        products,
      };
    }
    case "recommend_products": {
      // The store's recommendation engine (D139): the same rules as its pages, for this visitor; the model only words them.
      const handle = text("handle") || /^\/(?:[^/]+\/){0,3}p\/([a-z0-9-]+)/.exec(request.path ?? "")?.[1] || "";
      const looking = handle ? await getProduct(store.id, market, handle) : null;
      const query = text("query");
      const signals = { ...request.signals, searches: query ? [query, ...request.signals.searches].slice(0, 5) : request.signals.searches };
      const { on, picked } = await recommendForChat(store, market, { productId: looking?.id ?? null, signals });
      if (!on) return { result: json({ note: "The store's recommendations are off. Use search_products to find products instead." }) };
      if (picked.length === 0) return { result: json({ products: [], note: "Nothing to recommend right now. Say so, or search for what the visitor wants." }) };
      const notices = await campaignNotices(store.id, market);
      const offers = new Map(picked.map(({ product }) => [product.id, offersOn(site, notices, product.id, { gifts: false })] as const));
      return {
        result: json({
          products: picked.map(({ product, kind, note }) => {
            const told = offers.get(product.id)?.told ?? [];
            return {
              handle: product.handle,
              title: product.title,
              price: priceText(product.price, market.locale, market.lang, product.priceVaries),
              relation: kind === "upsell" ? "a step up from what they are looking at" : kind === "complement" ? "an accessory or add-on that goes with it" : kind === "cross_sell" ? "a related product" : "similar to what they have shown interest in",
              ...(note ? { why: note } : {}),
              ...(told.length > 0 && { offers: told }),
            };
          }),
          note: "Present these, briefly, in this order. Do not add other products.",
        }),
        products: picked.map(({ product }) => card(site, product, product.priceVaries, offers.get(product.id)?.card)),
      };
    }
    case "get_product": {
      const product = await getProduct(store.id, market, text("handle"));
      if (!product) return { result: json({ error: "No such product in this store." }) };
      const [stock, notices] = await Promise.all([getVariantStock(store.id, product.variants.map((v) => v.id)), campaignNotices(store.id, market)]);
      const offers = offersOn(site, notices, product.id, { gifts: true });
      const cheapest = product.variants.reduce((low, v) => (v.price.amountMinor < low.price.amountMinor ? v : low), product.variants[0]);
      return {
        result: json({
          title: product.title,
          kind: product.kind === "goods" ? "product" : product.kind === "appointment" ? "appointment booked for a time on its page" : `${product.kind} booked for dates on its page`,
          description: product.description.slice(0, 1500),
          variants: product.variants.map((v) => ({
            options: v.options,
            price: priceText(v.price, market.locale, market.lang, false),
            // Stock, policy and days are the store's own read (D172): the answer says "on backorder" only when this says so, and the days as given.
            ...stockFacts(v.delivery === "physical" ? stock.get(v.id) : UNLIMITED),
          })),
          subscriptions: product.plans.length > 0,
          // What the owner has let the chat say of the product\'s custom fields (D118), in the shopper\'s words.
          ...(chatDetails(product.fields).length > 0 ? { details: chatDetails(product.fields) } : {}),
          ...(offers.told.length > 0 ? { offers: offers.told, offersNote: "Offers are taken off in the cart." } : {}),
          ...(product.hostName ? { host: product.hostName } : {}),
        }),
        products: cheapest
          ? [card(site, { handle: product.handle, title: product.title, image: product.images[0] ?? null, price: cheapest.price }, product.variants.length > 1, offers.card)]
          : [],
      };
    }
    case "search_content": {
      const passages = await searchKnowledge(store.id, text("query"), market.locale);
      return {
        result: json({
          passages: passages.map((p) => ({ title: p.title, page: p.path, text: p.body })),
          ...(passages.length === 0 ? { note: "Nothing found in the store's pages or knowledge base." } : {}),
        }),
      };
    }
    case "store_info": {
      const [shipping, pages] = await Promise.all([getShippingFacts(store.id, market), publishedPageNames(store.id, market.locale)]);
      const details = store.details;
      return {
        result: json({
          name: store.name,
          company: [details.legalName, details.organisationNumber && `org. ${details.organisationNumber}`].filter(Boolean).join(", ") || null,
          email: details.contactEmail,
          address: details.postalAddress,
          countries: store.markets.map((m) => m.name),
          visitorCountry: market.name,
          sellsTo: selling ? store.audience : null,
          sellsOnline: selling,
          shipping: selling && shipping
            ? {
                cost: formatMoney(shipping.amountMinor, shipping.currency, market.locale),
                freeOver: shipping.freeOverMinor === null ? null : formatMoney(shipping.freeOverMinor, shipping.currency, market.locale),
              }
            : null,
          returns: selling ? returnFacts(store.returnPolicy, marketPath(store.slug, market.slug, "/withdraw")) : null,
          pages: [...new Map(pages.map(([, page]) => [page.slug, page.title])).entries()].slice(0, 30).map(([slug, title]) => ({ slug, title })),
        }),
      };
    }
    case "navigate":
      return navigateStore(site, args);
  }
  return { result: json({ error: `No tool called ${name}.` }) };
}

async function navigateStore(site: Extract<ChatSite, { kind: "store" }>, raw: Record<string, unknown>): Promise<ToolOutcome> {
  const { store, market } = site;
  const parsed = navigateArgs.safeParse(raw);
  if (!parsed.success) return { result: json({ error: "Say where to go." }) };
  const { to, handle = "", slug = "", query = "" } = parsed.data;
  const m = t(market.lang);
  // A website (D178 step 5: the online shop off) has no shop's places to open.
  if (!featureOn(store, "shop") && (SHOP_DESTINATIONS as readonly string[]).includes(to)) return { result: json({ error: "The agent cannot open that." }) };
  const go = (path: string, label: string): ToolOutcome => {
    const href = marketPath(store.slug, market.slug, path);
    return { result: json({ opened: href }), action: { type: "navigate", href, label } };
  };
  const missing = (what: string) => ({ result: json({ error: `No ${what} with that address. Search first.` }) });
  switch (to) {
    case "home":
      return go("", store.name);
    case "products":
      return go("/products", m.allProducts);
    case "cart":
      return go("/cart", m.cart);
    case "account":
      return go("/account", m.account.title);
    case "wishlist":
      return go("/wishlist", m.wishlist.title);
    case "blog":
      return go("/blog", m.blog);
    case "search":
      return query.trim() ? go(`/search?q=${encodeURIComponent(query.trim())}`, m.search.title) : { result: json({ error: "Say what to search for." }) };
    case "product": {
      const product = await getProduct(store.id, market, handle);
      return product ? go(`/p/${product.handle}`, product.title) : missing("product");
    }
    case "page":
    case "article": {
      const pages = new Map(await publishedPageNames(store.id, market.locale, to));
      const page = pages.get(slug);
      return page ? go(`${to === "article" ? "/blog" : ""}/${page.slug}`, page.title) : missing(to);
    }
    case "category":
    case "tag": {
      const term = (await siteTerms(store.id, "product")).find((candidate) => candidate.kind === to && candidate.slug === slug);
      return term ? go(`/${to}/${term.slug}`, term.name) : missing(to);
    }
  }
  return { result: json({ error: "The agent cannot open that." }) };
}

async function kaizenTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  switch (name) {
    case "search_content": {
      const passages = await searchKnowledge(null, typeof args.query === "string" ? args.query.slice(0, 200) : "", "en-GB");
      return { result: json({ passages: passages.map((p) => ({ title: p.title, page: p.path, text: p.body })) }) };
    }
    case "site_info": {
      const chrome = await getPlatformChrome();
      const pages = [...chrome.pages.values()].map((page) => ({ slug: page.slug, title: page.title })).slice(0, 30);
      return { result: json({ name: "Kaizen", company: chrome.business.legalName || null, email: chrome.business.contactEmail || null, pages }) };
    }
    case "navigate": {
      const parsed = navigateArgs.safeParse(args);
      if (!parsed.success) return { result: json({ error: "Say where to go." }) };
      const { to, slug = "" } = parsed.data;
      const go = (href: string, label: string): ToolOutcome => ({ result: json({ opened: href }), action: { type: "navigate", href, label } });
      if (to === "home") return go("/", "Kaizen");
      if (to === "blog") return go("/blog", "Blog");
      if (to === "signUp") return go("/sign-up", "Start your store");
      if (to === "signIn") return go("/admin", "Sign in");
      if (to === "page" || to === "article") {
        const pages = new Map(await publishedPageNames(null, null, to));
        const page = pages.get(slug);
        return page ? go(`${to === "article" ? "/blog" : ""}/${page.slug}`, page.title) : { result: json({ error: `No ${to} with that address.` }) };
      }
      return { result: json({ error: "The agent cannot open that." }) };
    }
  }
  return { result: json({ error: `No tool called ${name}.` }) };
}

/**
 * Answers the visitor's last message: the model gets the rules, the
 * conversation and the site's tools, runs tools for up to a few rounds,
 * and words the answer. What the tools opened and found goes with it.
 */
export async function runChat(site: ChatSite, agent: ChatAgent, request: ChatRequest, connection: AiConnection): Promise<ChatReply> {
  const lang = site.kind === "store" ? site.market.lang : "en";
  const m = t(lang);
  const messages: ToolChatMessage[] = [
    {
      role: "system",
      content: systemPrompt({
        site: site.kind === "store" ? site.store.name : "Kaizen",
        kind: site.kind,
        agentName: agent.name,
        occupation: agent.occupation,
        lang,
        instructions: agent.instructions,
        path: request.path ?? null,
        today: new Date().toISOString().slice(0, 10),
      }),
    },
    ...request.messages.map((message) => ({ role: message.role, content: message.content }) as ToolChatMessage),
  ];
  const tools = site.kind === "store" ? storeTools(featureOn(site.store, "shop")) : kaizenTools();
  let action: ChatAction | null = null;
  const products = new Map<string, ChatProduct>();
  for (let round = 0; round <= ROUNDS; round++) {
    // The last round has no tools, so the model answers with what it has.
    const step = await chatWithTools(connection, messages, round < ROUNDS ? tools : [], { maxTokens: 600 });
    if (step.toolCalls.length === 0 || round === ROUNDS) {
      const reply = cleanReply(step.content ?? "", m.chat.sorry);
      return { reply, actions: action ? [action] : [], products: [...products.values()].slice(0, 6) };
    }
    messages.push({ role: "assistant", content: step.content, tool_calls: step.toolCalls });
    for (const call of step.toolCalls.slice(0, 4)) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        // Unreadable arguments: the tool says what it needs.
      }
      let outcome: ToolOutcome;
      try {
        outcome = site.kind === "store" ? await storeTool(site, call.function.name, args, request) : await kaizenTool(call.function.name, args);
      } catch (error) {
        if (error instanceof AiError) throw error;
        console.warn(`[chat] tool ${call.function.name} failed: ${error instanceof Error ? error.message : String(error)}`);
        outcome = { result: json({ error: "That did not work just now." }) };
      }
      if (outcome.action) action = outcome.action;
      for (const product of outcome.products ?? []) products.set(product.handle, product);
      messages.push({ role: "tool", tool_call_id: call.id, content: outcome.result });
    }
    // Tool calls beyond the first four get an answer too, so the conversation stays well formed.
    for (const call of step.toolCalls.slice(4)) messages.push({ role: "tool", tool_call_id: call.id, content: json({ error: "Too many tools at once." }) });
  }
  return { reply: m.chat.sorry, actions: [], products: [] };
}

/**
 * What the chat may say of one variant's stock, from the store's own read: whether it can be bought, and for a variant that keeps
 * selling at zero, that it is on backorder and the days the store states. The words never come from the model.
 */
function stockFacts(stock: VariantStock | undefined): { available: boolean; availability: "in stock" | "on backorder" | "sold out"; backorderShipsWithinDays?: number } {
  if (!stock || stock === UNLIMITED) return { available: stock === UNLIMITED, availability: stock === UNLIMITED ? "in stock" : "sold out" };
  const kind = availabilityOf(stock);
  if (kind === "in_stock") return { available: true, availability: "in stock" };
  if (kind === "backorder" && stock.backorderDays !== null) return { available: true, availability: "on backorder", backorderShipsWithinDays: stock.backorderDays };
  return { available: false, availability: "sold out" };
}

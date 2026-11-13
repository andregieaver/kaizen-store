import "server-only";

import { z } from "zod";

import { t } from "@/lib/i18n";
import { fail } from "@/lib/route-fail";

import { aiFor, type AiConnection } from "./ai";
import { getChatAgent, takeChatTurn, type ChatAgent, type ChatSite } from "./chat-agent";
import { visitorKey } from "./chat-turns";
import { lockedOut } from "./private-mode";
import { resolveShop } from "./shop";
import { frameWidget, widgetShop } from "./support-widgets";
import { ensureDesk, type DeskSettings } from "./support";
import { visitorDesk } from "./support-desk";

/**
 * What the chat's routes share (D81): which site a request is for, whether its agent is on, and the visitor's limits. Visitors'
 * requests come only from the site's own pages. The conversation itself is support's (D216, `support-route.ts`).
 */

const siteInput = z.object({
  store: z.string().regex(/^[a-z0-9-]{1,63}$/).optional(),
  market: z.string().regex(/^[a-z]{2}(?:-[a-z]{2})?(?:-[a-z]{3})?$/).optional(),
  /** A chat widget on a site of the owner's own (D581): the widget's key and the host of the page its frame is on. */
  embed: z.string().regex(/^[a-z0-9]{20}$/).optional(),
  host: z.string().max(253).optional(),
});

/** The site a visitor writes from: a store in one of its countries, or Kaizen's. */
export type ChatPlace = { site: ChatSite; storeId: string | null; lang: string; locale: string; market: string | null };

/**
 * The site, its desk's settings, and its agent and AI while the AI answers there (D216): with support off the agent must be on and
 * have a text model (else the chat is closed, as before); with the AI first it answers when the site has a saved agent and a text
 * model (else conversations go to the queue); with people only there is none.
 */
export type ChatContext = ChatPlace & { settings: DeskSettings; agent: ChatAgent | null; connection: AiConnection | null };

/** A site's turns a day while no model is asked (people only): the visitor's own limit still holds. */
const PEOPLE_DAILY_LIMIT = 100_000;

/** The site a request names (a store that is not open is a 404, as its pages are), else the response to give. */
export async function chatPlace(raw: unknown): Promise<ChatPlace | Response> {
  const where = siteInput.safeParse(raw);
  if (!where.success) return fail(400, "The chat could not read that message.");
  if (where.data.embed) return embedPlace(where.data.embed, where.data.host ?? "");
  if (!where.data.store) return { site: { kind: "kaizen" }, storeId: null, lang: "en", locale: "en-GB", market: null };
  const shop = await resolveShop(where.data.store, where.data.market ?? "");
  if (!shop) return fail(404, "No such store.");
  // A private store's chat (D339) answers only a visitor let in, as its pages do.
  if (await lockedOut(shop.store)) return fail(404, "No such store.");
  return { site: { kind: "store", store: shop.store, market: shop.market }, storeId: shop.store.id, lang: shop.market.lang, locale: shop.market.locale, market: shop.market.slug };
}

/**
 * A chat widget on a site of the owner's own (D581): the desk of the widget whose tag carries the key, when the page's host is one of its
 * sites and the tag was found there, in the market chosen for the widget (else the store's first); a store that is not open is a 404, as its
 * own chat is. A private store (D339) still answers there: the owner put the chat on their own site, and it reads only the knowledge base.
 */
async function embedPlace(key: string, host: string): Promise<ChatPlace | Response> {
  const widget = await frameWidget(key, host);
  if (!widget?.verified) return fail(404, "No such site.");
  const embed = { id: widget.id, host: widget.host, privacyUrl: widget.privacyUrl };
  if (!widget.storeId) return { site: { kind: "kaizen", embed }, storeId: null, lang: "en", locale: "en-GB", market: null };
  const shop = await widgetShop(widget);
  if (!shop) return fail(404, "No such site.");
  return { site: { kind: "store", store: shop.store, market: shop.market, embed }, storeId: shop.store.id, lang: shop.market.lang, locale: shop.market.locale, market: shop.market.slug };
}

/** The site's desk, and its agent and AI while the AI answers there (see `ChatContext`), else the response to give. */
export async function chatContext(place: ChatPlace): Promise<ChatContext | Response> {
  const [agent, connection, desk] = await Promise.all([getChatAgent(place.storeId), aiFor(place.storeId, { feature: "chat_agent" }), ensureDesk(visitorDesk(place.site))]);
  // A store that handles sensitive information (PSI AST-08): people answer its chat, so no AI reads what a visitor writes.
  const settings = desk.sensitive && desk.mode !== "off" ? { ...desk, mode: "people" as const } : desk;
  const ai = !desk.sensitive && agent !== null && Boolean(connection?.textModel) && settings.mode !== "people" && (settings.mode === "ai_first" || agent.enabled);
  if (settings.mode === "off" && !ai) return fail(404, t(place.lang).chat.closed);
  return { ...place, settings, agent: ai ? agent : null, connection: ai ? connection : null };
}

/**
 * Counts the visitor's message before any model is asked. Past the visitor's limit, the response to give; past the site's daily
 * limit, the response with support off (the chat is closed for today, as before), else `limit`: the message is kept and the
 * conversation goes to a person (2.12).
 */
export async function takeTurn(context: ChatContext, request: Request): Promise<Response | "limit" | null> {
  const m = t(context.lang);
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const turn = await takeChatTurn(context.storeId, visitorKey(address), context.agent?.dailyLimit ?? PEOPLE_DAILY_LIMIT);
  if (turn === "ok") return null;
  if (turn === "busy") return fail(429, m.chat.busy);
  return context.settings.mode === "off" ? fail(429, m.chat.closed) : "limit";
}

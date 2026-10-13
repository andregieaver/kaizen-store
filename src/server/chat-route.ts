import "server-only";

import { z } from "zod";

import { t } from "@/lib/i18n";

import { aiFor, type AiConnection } from "./ai";
import { getChatAgent, takeChatTurn, visitorKey, type ChatAgent, type ChatSite } from "./chat-agent";
import { resolveShop } from "./shop";
import { ensureDesk, type DeskSettings } from "./support";
import { visitorDesk } from "./support-desk";

/**
 * What the chat's routes share (D81): which site a request is for, whether its agent is on, and the visitor's limits. Visitors'
 * requests come only from the site's own pages. The conversation itself is support's (D216, `support-route.ts`).
 */

const siteInput = z.object({ store: z.string().regex(/^[a-z0-9-]{1,63}$/).optional(), market: z.string().regex(/^[a-z]{2}(?:-[a-z]{2})?(?:-[a-z]{3})?$/).optional() });

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

export const fail = (status: number, message: string) =>
  Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

// A request from another site is refused: the chat is for the site's own visitors (kept here for the routes that import it from here).
export { sameSite } from "@/lib/same-site";

/** The site a request names (a store that is not open is a 404, as its pages are), else the response to give. */
export async function chatPlace(raw: unknown): Promise<ChatPlace | Response> {
  const where = siteInput.safeParse(raw);
  if (!where.success) return fail(400, "The chat could not read that message.");
  if (!where.data.store) return { site: { kind: "kaizen" }, storeId: null, lang: "en", locale: "en-GB", market: null };
  const shop = await resolveShop(where.data.store, where.data.market ?? "");
  if (!shop) return fail(404, "No such store.");
  return { site: { kind: "store", store: shop.store, market: shop.market }, storeId: shop.store.id, lang: shop.market.lang, locale: shop.market.locale, market: shop.market.slug };
}

/** The site's desk, and its agent and AI while the AI answers there (see `ChatContext`), else the response to give. */
export async function chatContext(place: ChatPlace): Promise<ChatContext | Response> {
  const [agent, connection, settings] = await Promise.all([getChatAgent(place.storeId), aiFor(place.storeId, { feature: "chat_agent" }), ensureDesk(visitorDesk(place.site))]);
  const ai = agent !== null && Boolean(connection?.textModel) && settings.mode !== "people" && (settings.mode === "ai_first" || agent.enabled);
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

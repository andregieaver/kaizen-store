import "server-only";

import { z } from "zod";

import { t } from "@/lib/i18n";

import { aiFor, type AiConnection } from "./ai";
import { getChatAgent, takeChatTurn, visitorKey, type ChatAgent, type ChatSite } from "./chat-agent";
import { resolveShop } from "./shop";

/**
 * What the chat's routes share (D81): which site a request is for, whether its agent is on, and the visitor's limits. Visitors'
 * requests come only from the site's own pages. The conversation itself is support's (D216, `support-route.ts`).
 */

const siteInput = z.object({ store: z.string().regex(/^[a-z0-9-]{1,63}$/).optional(), market: z.string().regex(/^[a-z]{2}(?:-[a-z]{2})?(?:-[a-z]{3})?$/).optional() });

/** The site a visitor writes from: a store in one of its countries, or Kaizen's. */
export type ChatPlace = { site: ChatSite; storeId: string | null; lang: string; locale: string; market: string | null };

/** The site, its agent and its AI. */
export type ChatContext = ChatPlace & { agent: ChatAgent; connection: AiConnection };

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

/** The site's agent and AI while the agent is on and has a text model, else the response to give. */
export async function chatContext(place: ChatPlace): Promise<ChatContext | Response> {
  const [agent, connection] = await Promise.all([getChatAgent(place.storeId), aiFor(place.storeId, { feature: "chat_agent" })]);
  if (!agent?.enabled || !connection?.textModel) return fail(404, t(place.lang).chat.closed);
  return { ...place, agent, connection };
}

/** Counts the visitor's message before any model is asked; past the visitor's or the site's limit, the response to give. */
export async function takeTurn(context: ChatContext, request: Request): Promise<Response | null> {
  const m = t(context.lang);
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const turn = await takeChatTurn(context.storeId, visitorKey(address), context.agent.dailyLimit);
  return turn === "ok" ? null : fail(429, turn === "busy" ? m.chat.busy : m.chat.closed);
}

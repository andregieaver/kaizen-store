import "server-only";

import { z } from "zod";

import { chatRequest, type ChatReply, type ChatRequest } from "@/lib/chat";
import { t } from "@/lib/i18n";

import { AiError, aiFor, type AiConnection } from "./ai";
import { getChatAgent, runChat, takeChatTurn, visitorKey, type ChatAgent, type ChatSite } from "./chat-agent";
import { resolveShop } from "./shop";

/**
 * What the chat's routes share (D81): which site a request is for, whether
 * its agent is on, the visitor's limits, and the answer. Visitors' requests
 * come only from the site's own pages.
 */

const siteInput = z.object({ store: z.string().regex(/^[a-z0-9-]{1,63}$/).optional(), market: z.string().regex(/^[a-z]{2}$/).optional() });

export type ChatContext = { site: ChatSite; storeId: string | null; agent: ChatAgent; connection: AiConnection; lang: string; request: ChatRequest };

export const fail = (status: number, message: string) =>
  Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

/** A request from another site is refused: the chat is for the site's own visitors. */
export function sameSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    return new URL(origin).host === (request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
  } catch {
    return false;
  }
}

/** The site, its agent and AI, and the checked conversation; else the response to give. */
export async function chatContext(raw: unknown): Promise<ChatContext | Response> {
  const where = siteInput.safeParse(raw);
  const parsed = chatRequest.safeParse(raw);
  if (!where.success || !parsed.success) return fail(400, "The chat could not read that message.");
  let site: ChatSite;
  let storeId: string | null = null;
  if (where.data.store) {
    const shop = await resolveShop(where.data.store, where.data.market ?? "");
    if (!shop) return fail(404, "No such store.");
    site = { kind: "store", store: shop.store, market: shop.market };
    storeId = shop.store.id;
  } else {
    site = { kind: "kaizen" };
  }
  const lang = site.kind === "store" ? site.market.lang : "en";
  const [agent, connection] = await Promise.all([getChatAgent(storeId), aiFor(storeId, { feature: "chat_agent" })]);
  if (!agent?.enabled || !connection?.textModel) return fail(404, t(lang).chat.closed);
  return { site, storeId, agent, connection, lang, request: parsed.data };
}

/** Counts the visitor's message before any model is asked; past the visitor's or the site's limit, the response to give. */
export async function takeTurn(context: ChatContext, request: Request): Promise<Response | null> {
  const m = t(context.lang);
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const turn = await takeChatTurn(context.storeId, visitorKey(address), context.agent.dailyLimit);
  return turn === "ok" ? null : fail(429, turn === "busy" ? m.chat.busy : m.chat.closed);
}

/** Answers the conversation; the AI's failures become a sentence for the visitor. */
export async function answer(context: ChatContext): Promise<ChatReply | Response> {
  try {
    return await runChat(context.site, context.agent, context.request, context.connection);
  } catch (error) {
    console.warn(`[chat] ${context.storeId ?? "Kaizen"}: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof AiError) return fail(503, t(context.lang).chat.sorry);
    throw error;
  }
}

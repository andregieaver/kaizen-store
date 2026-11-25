import "server-only";

import { budgetVisitor, takeBudget, type BudgetEndpoint } from "./request-budget";
import { pollPluginSignIn, startPluginSignIn } from "./plugin-sign-in";

/**
 * The two doors a design tool's app signs in through (D898 F1): any origin may call them (a Figma plugin's frame has none, and no cookie is
 * read), answers are never kept, and each address is counted. The sign-in itself is `plugin-sign-in.ts`.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "3600",
};

const answer = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store", ...CORS, ...headers } });

/** A browser's preflight. */
export const pluginPreflight = (): Response => new Response(null, { status: 204, headers: CORS });

async function counted(request: Request, endpoint: BudgetEndpoint): Promise<Response | null> {
  if (await takeBudget(null, endpoint, budgetVisitor(request.headers))) return null;
  return answer({ error: "Too many requests from this address: try again in a little while." }, 429, { "Retry-After": "60" });
}

/** The body as JSON when it is small, or null. */
async function small(request: Request): Promise<unknown> {
  const text = await request.text().catch(() => "");
  if (text.length > 2048) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** `POST /api/plugin/sign-in` with `{ "tool": "figma" }`: the secret to ask with, the code to show and the address to open. */
export async function startSignInRequest(request: Request): Promise<Response> {
  const refused = await counted(request, "plugin_sign_in");
  if (refused) return refused;
  const body = (await small(request)) as { tool?: unknown } | null;
  if (body?.tool !== "figma") return answer({ error: "Name the tool: figma." }, 400);
  return answer(await startPluginSignIn("figma"));
}

/** `POST /api/plugin/sign-in/poll` with `{ "readKey": "…" }`: waiting, declined, gone, or the token (once). */
export async function pollSignInRequest(request: Request): Promise<Response> {
  const refused = await counted(request, "plugin_poll");
  if (refused) return refused;
  const body = (await small(request)) as { readKey?: unknown } | null;
  return answer(await pollPluginSignIn(body?.readKey));
}

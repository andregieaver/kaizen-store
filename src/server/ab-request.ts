import "server-only";

import { headers } from "next/headers";

import { deviceOf, isBot, type Device } from "@/lib/experiments";

import { storeIdOfSlug } from "./experiments";

/**
 * What every A/B endpoint (D148) starts with: a small JSON body from the same site, from a visitor who is not a robot, for
 * a store that exists. Anything else is answered with nothing at all (204) so a script learns nothing, or refused (400).
 */
export type AbRequest = { body: Record<string, unknown>; storeId: string; storeSlug: string; device: Device };

export const quiet = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export async function abRequest(request: Request): Promise<AbRequest | Response> {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin) {
    try {
      if (new URL(origin).host !== host) return new Response(null, { status: 400 });
    } catch {
      return new Response(null, { status: 400 });
    }
  }
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 1000) return new Response(null, { status: 413 });
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return new Response(null, { status: 400 });
    body = parsed as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400 });
  }
  const userAgent = (await headers()).get("user-agent");
  if (isBot(userAgent)) return quiet();
  const storeSlug = typeof body.store === "string" ? body.store : "";
  if (!/^[a-z0-9-]{1,40}$/.test(storeSlug)) return new Response(null, { status: 400 });
  const storeId = await storeIdOfSlug(storeSlug);
  if (!storeId) return quiet();
  return { body, storeId, storeSlug, device: deviceOf(userAgent) };
}

import { connection } from "next/server";

import { registerClient } from "@/server/oauth-clients";
import { oauthError, oauthJson, oauthPreflight, overBudget, readBody } from "@/server/oauth-route";

/**
 * Dynamic client registration (RFC 7591, D439), kept for MCP clients that publish no Client ID Metadata Document: a public client only (no
 * secret is issued), its redirect URIs HTTPS or loopback, at most ten registrations an hour from one address (counted before anything is
 * read, failing closed).
 */
export async function POST(request: Request) {
  await connection();
  const budget = await overBudget(request, "oauth_register");
  if (budget) return budget;
  const body = await readBody(request, "json");
  if (!body.ok) return body.response;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return oauthError("invalid_client_metadata", "The body is not JSON.");
  }
  const registered = await registerClient(parsed);
  if (!registered.ok) return oauthError(registered.error, registered.problem);
  return oauthJson(registered.response, 201);
}

export const OPTIONS = oauthPreflight;

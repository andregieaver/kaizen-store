import { connection } from "next/server";

import { tokenRequest } from "@/server/oauth";
import { chargeClient, oauthError, oauthJson, oauthPreflight, overBudget, readBody } from "@/server/oauth-route";

/**
 * The token endpoint (RFC 6749 3.2, OAuth 2.1, D439): a code with its PKCE verifier, or a refresh token, swapped for an access token bound
 * to the grant's resource and a new refresh token. A public client names itself with `client_id`; an app authenticates with
 * `client_secret_basic`. Every request is counted for its address (`oauth`, an IPv6 one by its /64); only one whose secret, code or
 * refresh token proved good is also counted for its client (`oauth_token`, `chargeClient()`), so nobody can spend a client's budget
 * with made-up codes.
 */
export async function POST(request: Request) {
  await connection();
  const budget = await overBudget(request, "oauth");
  if (budget) return budget;
  const body = await readBody(request, "form");
  if (!body.ok) return body.response;
  const answer = await tokenRequest(new URLSearchParams(body.text), request.headers.get("authorization"), chargeClient);
  if (answer.ok) return oauthJson(answer.body);
  const headers: Record<string, string> = answer.basic ? { "WWW-Authenticate": 'Basic realm="Kaizena Flow"' } : answer.status === 429 ? { "Retry-After": "60" } : {};
  return oauthError(answer.error, answer.description, answer.status, headers);
}

export const OPTIONS = oauthPreflight;

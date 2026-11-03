import { connection } from "next/server";

import { revokeRequest } from "@/server/oauth";
import { chargeClient, clientBudgetSpent, oauthError, oauthPreflight, OAUTH_CORS, overBudget, readBody } from "@/server/oauth-route";

/**
 * Token revocation (RFC 7009, D439): the client that holds an access or refresh token ends its grant, with every token of it. Answers 200
 * whether or not the token was known; only a client that cannot be authenticated is refused.
 */
export async function POST(request: Request) {
  await connection();
  const budget = await overBudget(request, "oauth");
  if (budget) return budget;
  const body = await readBody(request, "form");
  if (!body.ok) return body.response;
  // Counted for its client too once it proved itself (a secret checked, or the client's own token found), as the token endpoint is.
  const answer = await revokeRequest(new URLSearchParams(body.text), request.headers.get("authorization"), chargeClient);
  if (!answer.ok) {
    if ("slow" in answer) return clientBudgetSpent();
    return oauthError("invalid_client", "The client could not be authenticated.", 401, answer.basic ? { "WWW-Authenticate": 'Basic realm="Kaizena Flow"' } : {});
  }
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store", ...OAUTH_CORS } });
}

export const OPTIONS = oauthPreflight;

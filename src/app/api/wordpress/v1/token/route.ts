import { connection } from "next/server";

import { exchangeCode } from "@/server/wordpress";
import { json, problem } from "@/server/wordpress-route";

/**
 * The plugin swaps the one-time code of an approval for its token (D169): `{ code, verifier, site }`. The answer is the token, shown
 * once. Every refusal is the same 400, so nothing says which part was wrong.
 */
export async function POST(request: Request) {
  await connection();
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 2_000) return problem(413, "too_large", "That request is too long.");
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return problem(400, "invalid_request", "That request could not be read.");
  }
  try {
    const swapped = await exchangeCode({ code: body.code, verifier: body.verifier, site: body.site });
    if (!swapped.ok) {
      return swapped.reason === "limited"
        ? problem(429, "rate_limited", "Too many attempts. Try again later.")
        : problem(400, "invalid_grant", "That approval is not valid any more. Connect again.");
    }
    return json({ token: swapped.token, account: swapped.account });
  } catch (error) {
    console.warn(`[wordpress] token: ${error instanceof Error ? error.message : String(error)}`);
    return problem(503, "unavailable", "Kaizen could not answer just now.");
  }
}

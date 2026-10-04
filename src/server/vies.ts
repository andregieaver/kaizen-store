import "server-only";

import {
  VIES_MAX_BODY_BYTES,
  VIES_RETRIES,
  VIES_TIMEOUT_MS,
  parseViesResponse,
  splitStoredNumber,
  viesEndpoint,
  viesRequestBody,
  viesUnavailable,
  viesWorthRetry,
  type ViesAnswer,
} from "@/lib/vies";

/**
 * The call to VIES, the Commission's VAT number service (D157, docs/wave-1a-tax.md section 4.3): one `POST` to a host
 * and path that are constants in `src/lib/vies.ts` (a test server is honoured only with `VIES_ALLOW_TEST_URL=1` and
 * never on Vercel), a body made only of a country code from the closed list of member states and the number's own
 * characters, a 4 second timeout, one retry after a timeout, a network error or a 5xx answer, and an answer read as text,
 * at most 16 KB, parsed defensively. It never throws: anything that is not a definite answer is `unavailable`, and an
 * unavailable answer neither exempts anyone from VAT nor stops a sale.
 *
 * It is never called while an order is being placed (`placeOrder()` reads what was checked before); `fetch` is injected
 * so tests never reach the network.
 */

export type ViesDeps = {
  /** The fetch to use: the platform's by default, a fake in tests. */
  fetch?: typeof fetch;
  /** Overrides the 4 second timeout (tests). */
  timeoutMs?: number;
  /** Overrides the address (tests of the address rules pass `endpoint()`'s result themselves). */
  endpoint?: string;
};

/** The address requests go to now: VIES, or the test server where the switch allows it. */
export const viesAddress = (): string =>
  viesEndpoint({ testUrl: process.env.VIES_TEST_URL, allowTest: process.env.VIES_ALLOW_TEST_URL, vercel: process.env.VERCEL });

/** The body of an answer as text, at most `VIES_MAX_BODY_BYTES` of it. */
async function readText(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return (await response.text()).slice(0, VIES_MAX_BODY_BYTES);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < VIES_MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))).slice(0, VIES_MAX_BODY_BYTES);
}

async function attempt(url: string, body: string, doFetch: typeof fetch, timeoutMs: number): Promise<ViesAnswer> {
  try {
    const response = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return parseViesResponse(response.status, await readText(response));
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return viesUnavailable(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
  }
}

/**
 * Asks VIES whether a number (normalised, with its prefix: `SE556677889901`) is valid. `requester` is the store's own
 * number when it has one that was checked valid, so that the answer carries a consultation number the seller can keep.
 */
export async function checkVatNumber(
  number: string,
  requester: string | null = null,
  deps: ViesDeps = {},
): Promise<ViesAnswer> {
  const split = splitStoredNumber(number);
  const asked = split && viesRequestBody(split, requester ? splitStoredNumber(requester) : null);
  if (!asked) return { status: "invalid", name: null, address: null, requestIdentifier: null, error: "not_a_member_number" };
  const url = deps.endpoint ?? viesAddress();
  const doFetch = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? VIES_TIMEOUT_MS;
  const body = JSON.stringify(asked);

  let answer = await attempt(url, body, doFetch, timeoutMs);
  for (let retry = 0; retry < VIES_RETRIES && viesWorthRetry(answer); retry++) {
    answer = await attempt(url, body, doFetch, timeoutMs);
  }
  return answer;
}

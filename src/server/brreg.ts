import "server-only";

import { cacheLife } from "next/cache";

import {
  BRREG_NAME_MIN,
  classifyQuery,
  isOrganisationNumber,
  parseCompany,
  parseHits,
  type BrregCompany,
  type BrregHit,
} from "@/lib/brreg";

/**
 * Brønnøysundregistrene's open Enhetsregisteret (`src/lib/brreg.ts`): the calls. The host is fixed and nothing but a
 * nine-digit number or the words a person typed is sent, so no client data leaves Kaizen (the registry is a Norwegian
 * public one, open under the NLOD licence, no key). A slow or broken registry never blocks anything: an answer is
 * `unavailable` and the person types the details as before. The company is cached for a day, since a name and an
 * address change rarely; a search is not cached, it is what someone is typing now.
 */

const BASE = "https://data.brreg.no/enhetsregisteret/api";
const TIMEOUT_MS = 6000;

export type BrregLookup =
  | { ok: true; company: BrregCompany }
  | { ok: false; reason: "invalid" | "not_found" | "unavailable" };

export type BrregSearch =
  | { ok: true; hits: BrregHit[]; total: number }
  | { ok: false; reason: "too_short" | "unavailable" };

async function call(url: string): Promise<Response> {
  return fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
}

/**
 * The registry's answer for one number: the JSON, `null` when there is no such unit (404, or 410 for one removed for
 * good), and a throw for anything else, so a hiccup is never kept in the cache as "not found".
 */
async function fetchUnit(digits: string): Promise<unknown | null> {
  "use cache";
  cacheLife("days");
  const response = await call(`${BASE}/enheter/${digits}`);
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new Error(`brreg ${response.status}`);
  return response.json();
}

/** Looks a company up by organisation number (nine digits, spaces and an NO prefix allowed). */
export async function lookupCompany(input: string): Promise<BrregLookup> {
  const query = classifyQuery(input);
  if (query.kind !== "number" || !isOrganisationNumber(query.digits)) return { ok: false, reason: "invalid" };
  try {
    const json = await fetchUnit(query.digits);
    if (json === null) return { ok: false, reason: "not_found" };
    const company = parseCompany(json);
    return company ? { ok: true, company } : { ok: false, reason: "not_found" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Searches the register by name: up to eight companies, the ones still in the register first. */
export async function searchCompanies(input: string): Promise<BrregSearch> {
  const query = classifyQuery(input);
  if (query.kind !== "name" || query.text.length < BRREG_NAME_MIN) return { ok: false, reason: "too_short" };
  try {
    const response = await call(`${BASE}/enheter?navn=${encodeURIComponent(query.text)}&size=8`);
    if (response.status === 404) return { ok: true, hits: [], total: 0 };
    if (!response.ok) return { ok: false, reason: "unavailable" };
    const json: unknown = await response.json();
    const total = Number((json as { page?: { totalElements?: unknown } })?.page?.totalElements ?? 0);
    return {
      ok: true,
      hits: parseHits(json),
      total: Number.isFinite(total) ? total : 0,
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

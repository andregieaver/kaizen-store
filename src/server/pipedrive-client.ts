import "server-only";

import {
  PIPEDRIVE_HOST,
  PIPEDRIVE_PAGE,
  readActivity,
  readDeal,
  readNote,
  readOrganization,
  readPerson,
  readPipeline,
  readStage,
  type PdAccount,
} from "@/lib/pipedrive";

/**
 * Pipedrive's API, read with an account's API token (S7 of `docs/own-books-and-sales.md`, D477): the token goes in the `x-api-token` header,
 * never in an address that could be logged. Lists come from API v2 by cursor (`/api/v2/…`, at most 500 a page); notes and the token's own
 * user from v1. A rate limit (429) is waited out as Pipedrive says (`Retry-After`, at most a minute, three times); a refused token is said
 * as such. Reads only: nothing is ever written to Pipedrive.
 */

export type PipedriveDeps = { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number };
export type PipedriveProblem = "token_refused" | "unreachable" | "too_slow" | "unexpected";
export class PipedriveError extends Error {
  constructor(readonly problem: PipedriveProblem) {
    super(`pipedrive: ${problem}`);
  }
}

const TIMEOUT_MS = 20_000;
const RETRIES = 3;

async function call(token: string, path: string, params: Record<string, string | number>, deps: PipedriveDeps): Promise<Record<string, unknown>> {
  const url = new URL(path, PIPEDRIVE_HOST);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await doFetch(url, { headers: { "x-api-token": token, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new PipedriveError("unreachable");
    }
    if (res.status === 401 || res.status === 403) throw new PipedriveError("token_refused");
    if (res.status === 429 && attempt < RETRIES) {
      const wait = Math.min(60, Math.max(1, Number(res.headers.get("retry-after")) || 2));
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new PipedriveError(res.status >= 500 ? "unreachable" : "unexpected");
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || body.success === false) throw new PipedriveError("unexpected");
    return body;
  }
}

/** Whose the token is: the user and the company it belongs to, or the problem (a refused token, Pipedrive not answering). */
export async function pipedriveWhoAmI(token: string, deps: PipedriveDeps = {}): Promise<{ name: string; company: string }> {
  const body = await call(token, "/v1/users/me", {}, deps);
  const data = (body.data ?? {}) as Record<string, unknown>;
  return { name: String(data.name ?? ""), company: String(data.company_name ?? "") };
}

/** Every page of a v2 list, by cursor, read as records; stops at the deadline. */
async function listV2<T>(token: string, path: string, read: (raw: unknown) => T | null, deps: PipedriveDeps, deadline: number): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  const now = deps.now ?? Date.now;
  do {
    if (now() > deadline) throw new PipedriveError("too_slow");
    const body = await call(token, path, { limit: PIPEDRIVE_PAGE, ...(cursor ? { cursor } : {}) }, deps);
    for (const raw of Array.isArray(body.data) ? body.data : []) {
      const item = read(raw);
      if (item) out.push(item);
    }
    const next = (body.additional_data as Record<string, unknown> | undefined)?.next_cursor;
    cursor = typeof next === "string" && next ? next : null;
  } while (cursor);
  return out;
}

/** Every page of a v1 list, by offset (notes), read as records; stops at the deadline. */
async function listV1<T>(token: string, path: string, read: (raw: unknown) => T | null, deps: PipedriveDeps, deadline: number): Promise<T[]> {
  const out: T[] = [];
  let start = 0;
  const now = deps.now ?? Date.now;
  for (;;) {
    if (now() > deadline) throw new PipedriveError("too_slow");
    const body = await call(token, path, { start, limit: PIPEDRIVE_PAGE }, deps);
    for (const raw of Array.isArray(body.data) ? body.data : []) {
      const item = read(raw);
      if (item) out.push(item);
    }
    const pagination = ((body.additional_data as Record<string, unknown> | undefined)?.pagination ?? {}) as Record<string, unknown>;
    if (pagination.more_items_in_collection !== true) return out;
    start = Number(pagination.next_start) || start + PIPEDRIVE_PAGE;
  }
}

/** The whole account as an import reads it, within `budgetMs`; a refused token, an unreachable Pipedrive or running out of time is thrown. */
export async function readPipedriveAccount(token: string, deps: PipedriveDeps = {}, budgetMs = 50_000): Promise<PdAccount> {
  const deadline = (deps.now ?? Date.now)() + budgetMs;
  const organizations = await listV2(token, "/api/v2/organizations", readOrganization, deps, deadline);
  const persons = await listV2(token, "/api/v2/persons", readPerson, deps, deadline);
  const pipelines = await listV2(token, "/api/v2/pipelines", readPipeline, deps, deadline);
  const stages = await listV2(token, "/api/v2/stages", readStage, deps, deadline);
  const deals = await listV2(token, "/api/v2/deals", readDeal, deps, deadline);
  const activities = await listV2(token, "/api/v2/activities", readActivity, deps, deadline);
  const notes = await listV1(token, "/v1/notes", readNote, deps, deadline);
  return { organizations, persons, pipelines, stages, deals, activities, notes };
}

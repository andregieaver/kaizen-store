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
  type PdFeed,
} from "@/lib/pipedrive";

/**
 * Pipedrive's API, read with an account's API token (S7 of `docs/own-books-and-sales.md`, D477): the token goes in the `x-api-token` header,
 * never in an address that could be logged. Lists come from API v2 by cursor (`/api/v2/…`, at most 500 a page); notes and the token's own
 * user from v1 (`pipedrivePage()` reads one page of a feed, so a run can stop between pages). A rate limit (429) is waited out as Pipedrive says (`Retry-After`, at most a minute, three times); a refused token is said
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
export async function pipedriveWhoAmI(token: string, deps: PipedriveDeps = {}): Promise<{ name: string; company: string; companyId: string }> {
  const body = await call(token, "/v1/users/me", {}, deps);
  const data = (body.data ?? {}) as Record<string, unknown>;
  const companyId = typeof data.company_id === "number" || (typeof data.company_id === "string" && /^\d+$/.test(data.company_id)) ? String(data.company_id) : "";
  return { name: String(data.name ?? ""), company: String(data.company_name ?? ""), companyId };
}

/** Where each feed is read: API v2 by cursor, users and notes still v1 by offset. */
const FEED_PATHS: Record<PdFeed, { path: string; v1: boolean }> = {
  users: { path: "/v1/users", v1: true },
  organizations: { path: "/api/v2/organizations", v1: false },
  persons: { path: "/api/v2/persons", v1: false },
  pipelines: { path: "/api/v2/pipelines", v1: false },
  stages: { path: "/api/v2/stages", v1: false },
  deals: { path: "/api/v2/deals", v1: false },
  activities: { path: "/api/v2/activities", v1: false },
  notes: { path: "/v1/notes", v1: true },
};

/** One page of a feed from `cursor` (v2's cursor, or v1's offset as text; null for the first), its raw records and where the next starts. */
export async function pipedrivePage(token: string, feed: PdFeed, cursor: string | null, deps: PipedriveDeps = {}): Promise<{ records: unknown[]; next: string | null }> {
  const { path, v1 } = FEED_PATHS[feed];
  if (v1) {
    const start = Number(cursor ?? 0) || 0;
    const body = await call(token, path, { start, limit: PIPEDRIVE_PAGE }, deps);
    const pagination = ((body.additional_data as Record<string, unknown> | undefined)?.pagination ?? {}) as Record<string, unknown>;
    const next = pagination.more_items_in_collection === true ? String(Number(pagination.next_start) || start + PIPEDRIVE_PAGE) : null;
    return { records: Array.isArray(body.data) ? body.data : [], next };
  }
  const body = await call(token, path, { limit: PIPEDRIVE_PAGE, ...(cursor ? { cursor } : {}) }, deps);
  const next = (body.additional_data as Record<string, unknown> | undefined)?.next_cursor;
  return { records: Array.isArray(body.data) ? body.data : [], next: typeof next === "string" && next ? next : null };
}

/** Every page of a feed, read as records; stops at the deadline. */
async function readFeed<T>(token: string, feed: PdFeed, read: (raw: unknown) => T | null, deps: PipedriveDeps, deadline: number): Promise<T[]> {
  const out: T[] = [];
  const now = deps.now ?? Date.now;
  let cursor: string | null = null;
  do {
    if (now() > deadline) throw new PipedriveError("too_slow");
    const page = await pipedrivePage(token, feed, cursor, deps);
    for (const raw of page.records) {
      const item = read(raw);
      if (item) out.push(item);
    }
    cursor = page.next;
  } while (cursor);
  return out;
}

/** The whole account as an import reads it, within `budgetMs`; a refused token, an unreachable Pipedrive or running out of time is thrown. */
export async function readPipedriveAccount(token: string, deps: PipedriveDeps = {}, budgetMs = 50_000): Promise<PdAccount> {
  const deadline = (deps.now ?? Date.now)() + budgetMs;
  const organizations = await readFeed(token, "organizations", readOrganization, deps, deadline);
  const persons = await readFeed(token, "persons", readPerson, deps, deadline);
  const pipelines = await readFeed(token, "pipelines", readPipeline, deps, deadline);
  const stages = await readFeed(token, "stages", readStage, deps, deadline);
  const deals = await readFeed(token, "deals", readDeal, deps, deadline);
  const activities = await readFeed(token, "activities", readActivity, deps, deadline);
  const notes = await readFeed(token, "notes", readNote, deps, deadline);
  return { organizations, persons, pipelines, stages, deals, activities, notes };
}

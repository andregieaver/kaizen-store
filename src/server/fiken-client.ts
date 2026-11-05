import "server-only";

import { randomUUID } from "node:crypto";

import { fikenEnv } from "@/lib/env";
import { FIKEN_API, FIKEN_REVOKE, FIKEN_TOKEN } from "@/lib/fiken";
import { classifyFikenFailure, fikenFailure, fikenNetworkFailure, type FikenFailure } from "@/lib/fiken-errors";

import { log } from "./log";

/**
 * Fiken's API (D460, `docs/fiken.md`): the token endpoint of its OAuth2 server, and the calls made with an access token. The addresses
 * are fixed in code; a path is built only from constants and Fiken's own ids. Every call has a timeout, follows no redirect, is never
 * cached and carries an `X-Request-ID`; its answer is the parsed JSON (with the `Location` of what it made) or a classified failure, never a
 * thrown error for anything Fiken says. Fiken takes one call at a time and slows a caller past four a second, so one `FikenApi` waits a
 * quarter of a second between its calls. Tokens live in memory for one run or one page action and are never logged or returned to a page.
 * Only `src/server/fiken*.ts` import this.
 */

export type FikenDeps = {
  /** The network (tests pass the fake Fiken's). */
  fetch?: typeof fetch;
  /** Kaizena Flow's app at Fiken (tests pass their own); `fikenEnv()` by default. */
  app?: () => { clientId: string; clientSecret: string } | null;
  /** The pause between calls (tests pass none). */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

export type FxResult<T> = { ok: true; value: T; location: string | null; requestId: string } | { ok: false; failure: FikenFailure };

const TIMEOUT_MS = 15_000;
const SPACING_MS = 260;

type Query = Record<string, string | number | boolean | undefined>;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Kaizena Flow's app, or null while it is not configured (or configured wrongly, which is logged once per call). */
export function fikenApp(deps: FikenDeps = {}): { clientId: string; clientSecret: string } | null {
  if (deps.app) return deps.app();
  try {
    return fikenEnv();
  } catch (error) {
    log("error", "fiken.misconfigured", {}, error);
    return null;
  }
}

/** A path of Fiken's API, built only from code and ids: one leading slash, no dots, no query. */
function urlOf(path: string, query?: Query): string {
  if (!/^\/[A-Za-z0-9/_-]+$/.test(path) || path.includes("..") || path.includes("//")) throw new Error("A Fiken path is a constant of the code");
  const url = new URL(`${FIKEN_API}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
  return url.toString();
}

async function call<T>(fetcher: typeof fetch, url: string, init: RequestInit): Promise<FxResult<T>> {
  const requestId = randomUUID();
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), "X-Request-ID": requestId },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, failure: { ...fikenNetworkFailure(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network"), requestId } };
  }
  if (response.status >= 300 && response.status < 400) return { ok: false, failure: { ...fikenNetworkFailure("redirect"), requestId } };
  const text = await response.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text === "" ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  const header = (name: string) => response.headers.get(name);
  if (!response.ok) return { ok: false, failure: classifyFikenFailure(response.status, json, text.slice(0, 2000), header, requestId) };
  return { ok: true, value: json as T, location: header("location"), requestId };
}

/** The calls of one access token, a quarter of a second apart. */
export type FikenApi = {
  get<T>(path: string, query?: Query): Promise<FxResult<T>>;
  post<T>(path: string, body: unknown, query?: Query): Promise<FxResult<T>>;
  put<T>(path: string, body: unknown): Promise<FxResult<T>>;
  patch<T>(path: string, query?: Query): Promise<FxResult<T>>;
  /** A file to an attachment (`multipart/form-data`, fields `filename` and `file`). */
  postFile<T>(path: string, file: { name: string; type: string; bytes: Uint8Array }, query?: Query): Promise<FxResult<T>>;
};

export function fikenApi(token: string, deps: FikenDeps = {}): FikenApi {
  const fetcher = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? wait;
  const auth = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  let last = 0;
  // One call at a time, spaced: each waits for the one before it.
  let queue: Promise<unknown> = Promise.resolve();
  const run = <T>(make: () => Promise<FxResult<T>>): Promise<FxResult<T>> => {
    const next = queue.then(async () => {
      const gap = SPACING_MS - (Date.now() - last);
      if (last > 0 && gap > 0) await sleep(gap);
      try {
        return await make();
      } finally {
        last = Date.now();
      }
    });
    queue = next.catch(() => undefined);
    return next;
  };
  const json = { ...auth, "Content-Type": "application/json" };
  return {
    get: (path, query) => run(() => call(fetcher, urlOf(path, query), { method: "GET", headers: auth })),
    post: (path, body, query) => run(() => call(fetcher, urlOf(path, query), { method: "POST", headers: json, body: JSON.stringify(body) })),
    put: (path, body) => run(() => call(fetcher, urlOf(path), { method: "PUT", headers: json, body: JSON.stringify(body) })),
    patch: (path, query) => run(() => call(fetcher, urlOf(path, query), { method: "PATCH", headers: auth })),
    postFile: (path, file, query) =>
      run(() => {
        const form = new FormData();
        form.set("filename", file.name);
        form.set("file", new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
        return call(fetcher, urlOf(path, query), { method: "POST", headers: auth, body: form });
      }),
  };
}

/** Every value of a list, a page at a time (Fiken's pages hold at most 100; `Fiken-Api-Page-Count` would say how many, a short page says the end). */
export async function listAll<T>(api: FikenApi, path: string, query: Query = {}, max = 2000): Promise<FxResult<T[]>> {
  const values: T[] = [];
  const pageSize = 100;
  for (let page = 0; page * pageSize < max; page += 1) {
    const got = await api.get<T[]>(path, { ...query, page, pageSize });
    if (!got.ok) return got;
    const list = Array.isArray(got.value) ? got.value : [];
    values.push(...list);
    if (list.length < pageSize) break;
  }
  return { ok: true, value: values, location: null, requestId: "" };
}

// ---------------------------------------------------------------------------------------------------------------------
// The OAuth2 token endpoint
// ---------------------------------------------------------------------------------------------------------------------

export type FikenTokens = { access: string; refresh: string | null; expiresAt: Date | null };

/** Why the token endpoint said no: `invalid_grant` (the code or the refresh token is spent, over or revoked), else another failure. */
export type TokenRefusal = { grant: boolean; failure: FikenFailure };

/**
 * One call to Fiken's token endpoint with Kaizena Flow's client id and secret (HTTP Basic): an authorization code (with its PKCE verifier)
 * or a refresh token for an access token. A refused grant is told apart from Fiken being down, so the caller knows whether to stop the
 * connection or try again later.
 */
export async function tokenCall(form: Record<string, string>, deps: FikenDeps = {}): Promise<{ ok: true; tokens: FikenTokens } | { ok: false; refusal: TokenRefusal }> {
  const app = fikenApp(deps);
  if (!app) return { ok: false, refusal: { grant: false, failure: fikenFailure("not_connected") } };
  const fetcher = deps.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetcher(FIKEN_TOKEN, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(form).toString(),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, refusal: { grant: false, failure: fikenNetworkFailure(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network") } };
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const grant = response.status === 400 || response.status === 401 ? body.error === "invalid_grant" || body.error === "invalid_client" || response.status === 401 : false;
    const failure = grant ? { ...fikenFailure("http_401", "auth"), status: response.status } : classifyFikenFailure(response.status, null, "", (n) => response.headers.get(n));
    return { ok: false, refusal: { grant, failure } };
  }
  const access = typeof body.access_token === "string" ? body.access_token : "";
  if (access === "" || access.length > 4000) return { ok: false, refusal: { grant: false, failure: fikenFailure("bad_answer", "transient") } };
  const seconds = typeof body.expires_in === "number" && Number.isFinite(body.expires_in) && body.expires_in > 0 ? body.expires_in : null;
  const now = (deps.now ?? (() => new Date()))().getTime();
  return {
    ok: true,
    tokens: {
      access,
      refresh: typeof body.refresh_token === "string" && body.refresh_token !== "" && body.refresh_token.length <= 4000 ? body.refresh_token : null,
      expiresAt: seconds === null ? null : new Date(now + seconds * 1000),
    },
  };
}

/** Revokes the grant at Fiken (Disconnect): the access token, its refresh token and the app's access to the company. Best effort. */
export async function revokeGrant(accessToken: string, deps: FikenDeps = {}): Promise<boolean> {
  try {
    const response = await (deps.fetch ?? fetch)(FIKEN_REVOKE, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

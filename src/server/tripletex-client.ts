import "server-only";

import { tripletexConsumerToken } from "@/lib/env";
import { TRIPLETEX_BASE, type TripletexMode, type TripletexTokenKind } from "@/lib/tripletex";
import { classifyFailure, networkFailure, type TripletexFailure } from "@/lib/tripletex-errors";

/**
 * Tripletex's API (D453, `docs/tripletex.md` 1.1): a session opened from the one token an owner pasted, and the calls made
 * with it. The address is one of two, fixed in code and chosen by the token (never typed). Every call has a timeout, follows
 * no redirect and is never cached; its answer is the parsed JSON or a classified failure (`classifyFailure()`), never a thrown
 * error for anything Tripletex says. A session token lives in memory for one run and is never kept, logged or returned. Only
 * `src/server/tripletex*.ts` import this.
 */

export type TripletexCredential = { kind: TripletexTokenKind; mode: TripletexMode; token: string };

export type TripletexDeps = {
  /** The network (tests pass the fake Tripletex's). */
  fetch?: typeof fetch;
  /** Kaizena Flow's consumer token for a mode (tests pass their own); `tripletexConsumerToken()` by default. */
  consumerToken?: (mode: TripletexMode) => string | null;
  now?: () => Date;
};

export type TxResult<T> = { ok: true; value: T; requestId: string | null } | { ok: false; failure: TripletexFailure };

const TIMEOUT_MS = 10_000;
/** A session for one run of the sync or one page action: an hour, within Tripletex's 5 minutes to 8 hours. */
const SESSION_SECONDS = 3600;

type Query = Record<string, string | number | boolean | undefined>;

function failure(key: string, kind: TripletexFailure["class"] = "rule"): TripletexFailure {
  return { class: kind, status: null, code: null, key, requestId: null, retryAfter: null, detail: null };
}

/** A path of Tripletex's API, built only from code: one leading slash, no dots, no query. */
function urlOf(mode: TripletexMode, path: string, query?: Query): string {
  if (!/^\/[A-Za-z0-9/_:>-]+$/.test(path) || path.includes("..")) throw new Error("A Tripletex path is a constant of the code");
  const url = new URL(`${TRIPLETEX_BASE[mode]}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
  return url.toString();
}

async function call<T>(fetcher: typeof fetch, url: string, init: RequestInit): Promise<TxResult<T>> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return { ok: false, failure: networkFailure(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network") };
  }
  if (response.status >= 300 && response.status < 400) return { ok: false, failure: networkFailure("redirect") };
  const text = await response.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text === "" ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  const header = (name: string) => response.headers.get(name);
  if (!response.ok) return { ok: false, failure: classifyFailure(response.status, json, header) };
  return { ok: true, value: json as T, requestId: header("x-tlx-request-id") };
}

/** Tomorrow in Oslo, as Tripletex's session expiry wants it: the token stops at midnight before that date. */
function tomorrow(now: Date): string {
  const day = new Date(now.getTime() + 24 * 3600 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" }).format(day);
}

/** One open session with Tripletex: the calls, signed in as the company the token belongs to (`0`). */
export type TripletexSession = {
  mode: TripletexMode;
  get<T>(path: string, query?: Query): Promise<TxResult<T>>;
  post<T>(path: string, body: unknown, query?: Query): Promise<TxResult<T>>;
  put<T>(path: string, body?: unknown, query?: Query): Promise<TxResult<T>>;
  /** A file to a voucher's attachment (`multipart/form-data`, field `file`). */
  postFile<T>(path: string, file: { name: string; type: string; bytes: Uint8Array }): Promise<TxResult<T>>;
};

/**
 * A session from the token: the company's own API token is exchanged on its own; an employee token needs Kaizena Flow's
 * consumer token for its environment, and fails as `no_consumer_token` while Tripletex has not given one.
 */
export async function openSession(credential: TripletexCredential, deps: TripletexDeps = {}): Promise<{ ok: true; session: TripletexSession } | { ok: false; failure: TripletexFailure }> {
  const fetcher = deps.fetch ?? fetch;
  const json = { "Content-Type": "application/json", Accept: "application/json" };
  let opened: TxResult<{ value?: { token?: unknown } }>;
  if (credential.kind === "api_token") {
    opened = await call(fetcher, urlOf(credential.mode, "/token/session/:createFromRefreshToken"), {
      method: "POST",
      headers: json,
      body: JSON.stringify({ refreshToken: credential.token, ttlSeconds: SESSION_SECONDS }),
    });
  } else {
    const consumer = (deps.consumerToken ?? tripletexConsumerToken)(credential.mode);
    if (!consumer) return { ok: false, failure: failure("no_consumer_token") };
    opened = await call(fetcher, urlOf(credential.mode, "/token/session/:create"), {
      method: "POST",
      headers: json,
      body: JSON.stringify({ consumerToken: consumer, employeeToken: credential.token, expirationDate: tomorrow((deps.now ?? (() => new Date()))()) }),
    });
  }
  if (!opened.ok) {
    // A token Tripletex refuses at the door is a sign-in failure, whatever status it chose for it.
    const f = opened.failure;
    return { ok: false, failure: f.class === "rule" || f.class === "permission" || f.class === "drift" ? { ...f, class: "auth", key: "http_401", detail: null } : f };
  }
  const token = opened.value?.value?.token;
  if (typeof token !== "string" || token === "") return { ok: false, failure: failure("bad_answer", "transient") };

  const auth = `Basic ${Buffer.from(`0:${token}`).toString("base64")}`;
  const headers = { ...json, Authorization: auth };
  const mode = credential.mode;
  return {
    ok: true,
    session: {
      mode,
      get: (path, query) => call(fetcher, urlOf(mode, path, query), { method: "GET", headers }),
      post: (path, body, query) => call(fetcher, urlOf(mode, path, query), { method: "POST", headers, body: JSON.stringify(body) }),
      put: (path, body, query) => call(fetcher, urlOf(mode, path, query), { method: "PUT", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
      postFile: (path, file) => {
        const form = new FormData();
        form.set("file", new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
        return call(fetcher, urlOf(mode, path), { method: "POST", headers: { Accept: "application/json", Authorization: auth }, body: form });
      },
    },
  };
}

/** Who the token is: the company it opens, read once at connect and compared with the store (`GET /token/session/>whoAmI`). */
export type TripletexCompany = { id: number; name: string; organizationNumber: string | null };

export async function whoAmI(session: TripletexSession): Promise<TxResult<TripletexCompany>> {
  const answer = await session.get<{ value?: { companyId?: unknown; company?: { id?: unknown; name?: unknown; organizationNumber?: unknown } } }>("/token/session/>whoAmI", {
    fields: "companyId,company(id,name,organizationNumber)",
  });
  if (!answer.ok) return answer;
  const value = answer.value?.value;
  const id = Number(value?.company?.id ?? value?.companyId);
  const name = typeof value?.company?.name === "string" ? value.company.name.trim() : "";
  if (!Number.isSafeInteger(id) || id <= 0 || name === "") return { ok: false, failure: failure("bad_answer", "transient") };
  const org = typeof value?.company?.organizationNumber === "string" && value.company.organizationNumber.trim() !== "" ? value.company.organizationNumber.trim() : null;
  return { ok: true, value: { id, name: name.slice(0, 255), organizationNumber: org }, requestId: answer.requestId };
}

/** Every value of a list, a page at a time (Tripletex caps a page; `fullResultSize` says how many there are). */
export async function listAll<T>(session: TripletexSession, path: string, query: Query = {}, max = 5000): Promise<TxResult<T[]>> {
  const values: T[] = [];
  const count = 1000;
  for (let from = 0; from < max; from += count) {
    const page = await session.get<{ values?: T[]; fullResultSize?: number }>(path, { ...query, from, count });
    if (!page.ok) return page;
    const got = Array.isArray(page.value?.values) ? page.value.values : [];
    values.push(...got);
    if (got.length < count) break;
  }
  return { ok: true, value: values, requestId: null };
}

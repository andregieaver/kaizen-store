/**
 * A Fiken in memory, for the integration tests of D460 (never imported by the app). It answers the calls Kaizena Flow makes as Fiken's
 * spec says it does (`api.fiken.no/api/v2/docs/swagger.yaml`): the OAuth2 token endpoint (an authorization code with its PKCE verifier,
 * a refresh token), revoke, the companies a grant opens, a company's accounts, contacts (found by organisation number, made with a
 * `Location`), sales ("Annet salg": found by sale number, made with a `Location`, read back with their totals, deleted with a flag),
 * transactions with their journal entry numbers, and attachments. It refuses what Fiken refuses (an account the company does not have, a
 * line whose VAT type is not a sale's, a locked period, a customer that is not a customer), and it can be told to fail: a status for the
 * next matching call, or a call that is done but whose answer is lost. It never refuses a second sale with the same number, so the tests
 * prove the sync's own lookup is what keeps a document from being booked twice.
 */

import { createHash } from "node:crypto";

type Json = Record<string, unknown>;

export type FakeCompany = { slug: string; name: string; organizationNumber: string | null; hasApiAccess: boolean; testCompany: boolean };

export type FakeSaleLine = { description: string; netPrice: number; vat: number; account: string; vatType: string };

export type FakeSale = {
  saleId: number;
  company: string;
  saleNumber: string;
  date: string;
  kind: string;
  currency: string;
  customerId: number;
  dueDate: string | null;
  lines: FakeSaleLine[];
  deleted: boolean;
  transactionId: number;
  journalEntryNumber: number;
  files: { name: string; type: string; size: number; head: string; attachToSale: boolean }[];
};

export type FakeContact = Json & { contactId: number; company: string; name: string; customer: boolean; customerNumber: number };

type Failure = { method: string; path: RegExp; status: number; body?: unknown; headers?: Record<string, string>; times: number };

export type FakeFikenCall = { method: string; path: string; status: number | "lost"; at: number };

const SALE_VAT_TYPES = ["NONE", "HIGH", "MEDIUM", "RAW_FISH", "LOW", "EXEMPT_IMPORT_EXPORT", "EXEMPT", "OUTSIDE", "EXEMPT_REVERSE"];

const ACCOUNTS = [
  { code: "1500", name: "Kundefordringer" },
  { code: "1920", name: "Bankinnskudd" },
  { code: "2400", name: "Leverandørgjeld" },
  { code: "2900", name: "Annen kortsiktig gjeld" },
  { code: "3000", name: "Salgsinntekt, avgiftspliktig" },
  { code: "3100", name: "Salgsinntekt, avgiftsfri" },
  { code: "3200", name: "Salgsinntekt, utenfor avgiftsområdet" },
];

export type FakeFiken = {
  fetch: typeof fetch;
  clientId: string;
  clientSecret: string;
  companies: FakeCompany[];
  accounts: Map<string, { code: string; name: string }[]>;
  contacts: Map<number, FakeContact>;
  sales: Map<number, FakeSale>;
  calls: FakeFikenCall[];
  /** Codes handed out, each with its PKCE challenge and the companies it opens. */
  issueCode(companies?: string[]): { code: string; verifier: string };
  /** Sales dated before this day are refused as in a locked period. */
  lockedBefore: string | null;
  /** The next matching call fails with this status, `times` times. */
  failNext(method: string, path: RegExp, status: number, body?: unknown, headers?: Record<string, string>, times?: number): void;
  /** The next matching call is done, but its answer never arrives. */
  loseAnswer(method: string, path: RegExp): void;
  /** Ends every access token now (they are refreshed), or every grant (refresh refused too). */
  expireAccess(): void;
  revokeGrants(): void;
  revoked: number;
  /** Refresh tokens spent: a second use of one is refused, as a rotated chain would be. */
  refreshes: number;
};

export function fakeFiken(options: { companies?: FakeCompany[] } = {}): FakeFiken {
  const failures: Failure[] = [];
  const lost: { method: string; path: RegExp }[] = [];
  const codes = new Map<string, { challenge: string; companies: string[] }>();
  const accessTokens = new Map<string, string[]>();
  const refreshTokens = new Map<string, string[]>();
  let nextId = 5000;
  let entry = 0;

  const state: FakeFiken = {
    fetch: null as unknown as typeof fetch,
    clientId: "kaizena-flow-test",
    clientSecret: "fiken-secret-for-tests",
    companies: options.companies ?? [{ slug: "human-web-as", name: "Human Web AS", organizationNumber: "912345678", hasApiAccess: true, testCompany: false }],
    accounts: new Map(),
    contacts: new Map(),
    sales: new Map(),
    calls: [],
    lockedBefore: null,
    revoked: 0,
    refreshes: 0,
    issueCode(companies) {
      const verifier = createHash("sha256").update(String(++nextId)).digest("base64url");
      const code = `code-${++nextId}`;
      codes.set(code, { challenge: createHash("sha256").update(verifier).digest("base64url"), companies: companies ?? state.companies.map((c) => c.slug) });
      return { code, verifier };
    },
    failNext(method, path, status, body, headers, times = 1) {
      failures.push({ method, path, status, body, headers, times });
    },
    loseAnswer(method, path) {
      lost.push({ method, path });
    },
    expireAccess() {
      accessTokens.clear();
    },
    revokeGrants() {
      accessTokens.clear();
      refreshTokens.clear();
    },
  };
  for (const c of state.companies) state.accounts.set(c.slug, ACCOUNTS.map((a) => ({ ...a })));

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(body === undefined || body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const created = (location: string) => new Response(null, { status: 201, headers: { Location: location } });
  const invalid = (message: string) => json(400, { message });

  function grant(companies: string[]) {
    const access = `access-${++nextId}`;
    const refresh = `refresh-${++nextId}`;
    accessTokens.set(access, companies);
    refreshTokens.set(refresh, companies);
    return { access_token: access, refresh_token: refresh, token_type: "bearer", expires_in: 86157 };
  }

  function tokenEndpoint(init: RequestInit | undefined): Response {
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const [id, secret] = Buffer.from(auth.replace(/^Basic /, ""), "base64").toString().split(":");
    if (id !== state.clientId || secret !== state.clientSecret) return json(401, { error: "invalid_client" });
    const form = new URLSearchParams(String(init?.body ?? ""));
    if (form.get("grant_type") === "authorization_code") {
      const code = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      if (!code || createHash("sha256").update(verifier).digest("base64url") !== code.challenge) return json(400, { error: "invalid_grant", error_description: "The authorization code is invalid or expired." });
      return json(200, grant(code.companies));
    }
    if (form.get("grant_type") === "refresh_token") {
      const companies = refreshTokens.get(form.get("refresh_token") ?? "");
      refreshTokens.delete(form.get("refresh_token") ?? "");
      if (!companies) return json(400, { error: "invalid_grant", error_description: "The refresh token is invalid." });
      state.refreshes += 1;
      return json(200, grant(companies));
    }
    return json(400, { error: "unsupported_grant_type" });
  }

  function postSale(company: string, body: Json): Response {
    const date = String(body.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return invalid("date is required");
    if (state.lockedBefore && date < state.lockedBefore) return invalid("Perioden er låst for bilagsføring.");
    const customer = state.contacts.get(Number(body.customerId));
    if (body.kind !== "cash_sale" && (!customer || customer.company !== company || !customer.customer)) return invalid("customerId must be a customer");
    const lines = Array.isArray(body.lines) ? (body.lines as FakeSaleLine[]) : [];
    if (lines.length === 0) return invalid("lines are required");
    const known = new Set((state.accounts.get(company) ?? []).map((a) => a.code));
    for (const l of lines) {
      if (!SALE_VAT_TYPES.includes(l.vatType)) return invalid(`vatType ${l.vatType} is not a sales VAT type`);
      if (!known.has(l.account)) return invalid(`Konto ${l.account} finnes ikke.`);
      if (!Number.isSafeInteger(l.netPrice) || !Number.isSafeInteger(l.vat)) return invalid("amounts are whole øre");
    }
    const saleId = ++nextId;
    state.sales.set(saleId, {
      saleId,
      company,
      saleNumber: String(body.saleNumber ?? ""),
      date,
      kind: String(body.kind),
      currency: String(body.currency),
      customerId: Number(body.customerId),
      dueDate: typeof body.dueDate === "string" ? body.dueDate : null,
      lines: lines.map((l) => ({ ...l })),
      deleted: false,
      transactionId: ++nextId,
      journalEntryNumber: ++entry,
      files: [],
    });
    return created(`https://api.fiken.no/api/v2/companies/${company}/sales/${saleId}`);
  }

  const saleAnswer = (s: FakeSale) => ({
    saleId: s.saleId,
    saleNumber: s.saleNumber,
    date: s.date,
    kind: s.kind,
    currency: s.currency,
    netAmount: s.lines.reduce((t, l) => t + l.netPrice, 0),
    vatAmount: s.lines.reduce((t, l) => t + l.vat, 0),
    lines: s.lines,
    customer: { contactId: s.customerId },
    deleted: s.deleted,
    transactionId: s.transactionId,
  });

  async function handle(method: string, url: URL, init: RequestInit | undefined): Promise<Response> {
    if (url.host === "fiken.no" && url.pathname === "/oauth/token" && method === "POST") return tokenEndpoint(init);
    if (url.host === "fiken.no" && url.pathname === "/oauth/revoke" && method === "POST") {
      const token = (new Headers(init?.headers).get("authorization") ?? "").replace(/^Bearer /, "");
      if (!accessTokens.has(token)) return json(401, { error: "invalid_token" });
      accessTokens.delete(token);
      state.revoked += 1;
      return json(200, {});
    }
    const path = url.pathname.replace(/^\/api\/v2/, "");
    const token = (new Headers(init?.headers).get("authorization") ?? "").replace(/^Bearer /, "");
    const opens = accessTokens.get(token);
    if (!opens) return json(401, { message: "Unauthorized" });
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Json) : {};

    if (method === "GET" && path === "/companies") return json(200, state.companies.filter((c) => opens.includes(c.slug)));
    const companyPath = path.match(/^\/companies\/([a-z0-9-]+)(\/.*)?$/);
    if (!companyPath || !opens.includes(companyPath[1])) return json(403, { message: "No access to company" });
    const company = companyPath[1];
    const rest = companyPath[2] ?? "";
    const info = state.companies.find((c) => c.slug === company)!;
    if (!info.hasApiAccess && rest !== "") return json(403, { message: "Company does not have the API module" });

    if (method === "GET" && rest === "/accounts") {
      const from = Number(url.searchParams.get("fromAccount") ?? 0);
      const to = Number(url.searchParams.get("toAccount") ?? 9999);
      return json(200, (state.accounts.get(company) ?? []).filter((a) => Number(a.code) >= from && Number(a.code) <= to));
    }
    if (rest === "/contacts") {
      if (method === "GET") {
        const org = url.searchParams.get("organizationNumber");
        return json(200, [...state.contacts.values()].filter((c) => c.company === company && (!org || c.organizationNumber === org)));
      }
      if (method === "POST") {
        if (typeof body.name !== "string" || body.name.trim() === "") return invalid("name is required");
        const contactId = ++nextId;
        state.contacts.set(contactId, { ...body, contactId, company, name: body.name, customer: body.customer === true, customerNumber: 10001 + state.contacts.size });
        return created(`https://api.fiken.no/api/v2/companies/${company}/contacts/${contactId}`);
      }
    }
    const contactPath = rest.match(/^\/contacts\/(\d+)$/);
    if (contactPath) {
      const contact = state.contacts.get(Number(contactPath[1]));
      if (!contact || contact.company !== company) return json(404, { message: "Not found" });
      if (method === "PUT") {
        state.contacts.set(contact.contactId, { ...body, contactId: contact.contactId, company, name: String(body.name ?? contact.name), customer: body.customer === true, customerNumber: contact.customerNumber });
        return created(`https://api.fiken.no/api/v2/companies/${company}/contacts/${contact.contactId}`);
      }
    }
    if (rest === "/sales") {
      if (method === "GET") {
        const number = url.searchParams.get("saleNumber");
        return json(200, [...state.sales.values()].filter((s) => s.company === company && (!number || s.saleNumber === number)).map(saleAnswer));
      }
      if (method === "POST") return postSale(company, body);
    }
    const salePath = rest.match(/^\/sales\/(\d+)(\/attachments)?$/);
    if (salePath) {
      const sale = state.sales.get(Number(salePath[1]));
      if (!sale || sale.company !== company) return json(404, { message: "Not found" });
      if (method === "GET" && !salePath[2]) return json(200, saleAnswer(sale));
      if (method === "POST" && salePath[2]) {
        const form = init?.body instanceof FormData ? init.body : null;
        const file = form?.get("file");
        if (!(file instanceof Blob) || typeof form?.get("filename") !== "string") return invalid("file and filename are required");
        const bytes = new Uint8Array(await file.arrayBuffer());
        sale.files.push({ name: String(form.get("filename")), type: file.type, size: bytes.length, head: new TextDecoder().decode(bytes.slice(0, 5)), attachToSale: url.searchParams.get("attachToSale") === "true" });
        return created(`https://api.fiken.no/api/v2/companies/${company}/sales/${sale.saleId}/attachments/${++nextId}`);
      }
    }
    const transactionPath = rest.match(/^\/transactions\/(\d+)$/);
    if (transactionPath && method === "GET") {
      const sale = [...state.sales.values()].find((s) => s.transactionId === Number(transactionPath[1]) && s.company === company);
      if (!sale) return json(404, { message: "Not found" });
      return json(200, { transactionId: sale.transactionId, type: "Salg", deleted: sale.deleted, entries: [{ journalEntryNumber: sale.journalEntryNumber, date: sale.date }] });
    }
    return json(404, { message: `No fake for ${method} ${path}` });
  }

  state.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (!["fiken.no", "api.fiken.no"].includes(url.host)) throw new TypeError(`The fake Fiken was called at ${url.host}`);
    const path = url.pathname;
    const fail = failures.find((f) => f.method === method && f.path.test(path) && f.times > 0);
    if (fail) {
      fail.times -= 1;
      state.calls.push({ method, path, status: fail.status, at: Date.now() });
      return json(fail.status, fail.body ?? { message: "Feil." }, fail.headers);
    }
    const response = await handle(method, url, init);
    const drop = lost.findIndex((l) => l.method === method && l.path.test(path));
    if (drop >= 0) {
      lost.splice(drop, 1);
      state.calls.push({ method, path, status: "lost", at: Date.now() });
      throw new TypeError("fetch failed");
    }
    state.calls.push({ method, path, status: response.status, at: Date.now() });
    return response;
  }) as typeof fetch;

  return state;
}

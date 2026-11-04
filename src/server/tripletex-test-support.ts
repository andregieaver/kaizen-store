/**
 * A Tripletex in memory, for the integration tests of D453 (never imported by the app). It answers the calls Kaizena Flow
 * makes (`docs/tripletex.md` Appendix C) as Tripletex's spec says it does: a session from an API token or from a consumer and
 * an employee token, `whoAmI`, the chart (accounts, VAT codes, voucher types), customers with versions, and vouchers with
 * their postings, external numbers, VAT worked out of each gross amount and numbers per year. It refuses what Tripletex
 * refuses (a posting on a customer account without its customer, a VAT code the account does not take, a closed period,
 * postings that do not balance), and it can be told to fail: a status for the next matching call, a rate limit, or a call
 * that is done but whose answer is lost. It never refuses a second voucher with the same external number, so the tests
 * prove the sync's own lookup is what keeps a document from being booked twice.
 */

type Json = Record<string, unknown>;

export type FakeAccount = {
  id: number;
  number: number;
  name: string;
  ledgerType?: "GENERAL" | "CUSTOMER" | "VENDOR";
  legalVatTypes?: { id: number }[];
  vatLocked?: boolean;
  vatType?: { id: number };
  isInactive?: boolean;
  requiresDepartment?: boolean;
};

export type FakeVatType = { id: number; number: string; name: string; percentage: number };

export type FakePosting = {
  row: number;
  date: string;
  description: string;
  account: { id: number };
  customer?: { id: number };
  vatType?: { id: number };
  amountGross: number;
  amountGrossCurrency: number;
  /** Without VAT, as Tripletex works it out. */
  amount: number;
  invoiceNumber?: string;
};

export type FakeVoucher = {
  id: number;
  version: number;
  number: number;
  year: number;
  date: string;
  description: string;
  externalVoucherNumber: string | null;
  voucherType: { id: number } | null;
  postings: FakePosting[];
  attachments: number;
};

export type FakeCustomer = Json & { id: number; version: number; name: string; organizationNumber?: string; customerNumber: number };

type Failure = { method: string; path: RegExp; status: number; body?: unknown; headers?: Record<string, string>; times: number };

export type FakeCall = { method: string; path: string; status: number | "lost" };

const VAT_TYPES: FakeVatType[] = [
  { id: 100, number: "0", name: "Ingen avgiftsbehandling", percentage: 0 },
  { id: 103, number: "3", name: "Utgående avgift, høy sats", percentage: 25 },
  { id: 131, number: "31", name: "Utgående avgift, middels sats", percentage: 15 },
  { id: 133, number: "33", name: "Utgående avgift, lav sats", percentage: 12 },
  { id: 105, number: "5", name: "Ingen utgående avgift (innenfor mva-loven)", percentage: 0 },
  { id: 106, number: "6", name: "Ingen utgående avgift (utenfor mva-loven)", percentage: 0 },
  { id: 152, number: "52", name: "Avgiftsfri utførsel av varer og tjenester", percentage: 0 },
];

/** Norway's standard chart, as Tripletex sets a new company up (the accounts the sync reads). */
const ACCOUNTS: FakeAccount[] = [
  { id: 15000, number: 1500, name: "Kundefordringer", ledgerType: "CUSTOMER" },
  { id: 27000, number: 2700, name: "Utgående merverdiavgift, høy sats", legalVatTypes: [{ id: 100 }] },
  { id: 29000, number: 2900, name: "Forskudd fra kunder", legalVatTypes: [{ id: 100 }] },
  { id: 30000, number: 3000, name: "Salgsinntekt, avgiftspliktig", legalVatTypes: [{ id: 103 }, { id: 131 }, { id: 133 }, { id: 100 }] },
  { id: 31000, number: 3100, name: "Salgsinntekt, avgiftsfri", legalVatTypes: [{ id: 105 }] },
  { id: 32000, number: 3200, name: "Salgsinntekt, utenfor avgiftsområdet", legalVatTypes: [{ id: 106 }, { id: 152 }] },
];

/** Half up, away from zero, in øre: gross × p / (100 + p). */
function vatOfGross(grossMinor: number, percentage: number): number {
  if (percentage === 0) return 0;
  const sign = grossMinor < 0 ? -1 : 1;
  const bp = BigInt(Math.round(percentage * 100));
  const abs = BigInt(Math.abs(grossMinor));
  const den = BigInt(10_000) + bp;
  return sign * Number((abs * bp * BigInt(2) + den) / (den * BigInt(2)));
}

const toMinor = (amount: number) => Math.round(amount * 100);

export type FakeTripletex = {
  fetch: typeof fetch;
  company: { id: number; name: string; organizationNumber: string | null };
  apiTokens: Set<string>;
  employeeTokens: Set<string>;
  consumerTokens: Set<string>;
  accounts: FakeAccount[];
  vatTypes: FakeVatType[];
  customers: Map<number, FakeCustomer>;
  vouchers: Map<number, FakeVoucher>;
  calls: FakeCall[];
  /** Vouchers dated before this day are refused as in a closed period. */
  closedBefore: string | null;
  /** The next matching call fails with this status, `times` times. */
  failNext(method: string, path: RegExp, status: number, body?: unknown, headers?: Record<string, string>, times?: number): void;
  /** The next matching call is done, but its answer never arrives (the network drops it). */
  loseAnswer(method: string, path: RegExp): void;
  /** Ends every session, as when the owner deletes the token in Tripletex. */
  revokeAll(): void;
  /** The VAT Tripletex worked out on a voucher, in øre (positive for an invoice). */
  vatOf(voucher: FakeVoucher): number;
};

export function fakeTripletex(options: { companyId?: number; companyName?: string; organizationNumber?: string | null } = {}): FakeTripletex {
  const sessions = new Map<string, true>();
  const failures: Failure[] = [];
  const lost: { method: string; path: RegExp }[] = [];
  let nextId = 1000;
  let voucherNumber = 0;

  const state: FakeTripletex = {
    fetch: null as unknown as typeof fetch,
    company: { id: options.companyId ?? 4242, name: options.companyName ?? "Human Web AS", organizationNumber: options.organizationNumber ?? "912345678" },
    apiTokens: new Set(),
    employeeTokens: new Set(),
    consumerTokens: new Set(),
    accounts: ACCOUNTS.map((a) => ({ ...a })),
    vatTypes: VAT_TYPES.map((v) => ({ ...v })),
    customers: new Map(),
    vouchers: new Map(),
    calls: [],
    closedBefore: null,
    failNext(method, path, status, body, headers, times = 1) {
      failures.push({ method, path, status, body, headers, times });
    },
    loseAnswer(method, path) {
      lost.push({ method, path });
    },
    revokeAll() {
      sessions.clear();
      state.apiTokens.clear();
      state.employeeTokens.clear();
    },
    vatOf(voucher) {
      return -voucher.postings.reduce((s, p) => s + (toMinor(p.amountGross) - toMinor(p.amount)), 0);
    },
  };

  const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "x-tlx-request-id": `req-${++nextId}`, ...headers },
    });
  const invalid = (message: string, field = "") => answer(422, { status: 422, code: 15000, message: "Validering feilet.", validationMessages: [{ field, message }] });
  const list = (values: unknown[], url: URL) => {
    const from = Number(url.searchParams.get("from") ?? 0);
    const count = Number(url.searchParams.get("count") ?? 1000);
    return answer(200, { fullResultSize: values.length, from, count, values: values.slice(from, from + count) });
  };

  function postVoucher(body: Json): Response {
    const postings = Array.isArray(body.postings) ? (body.postings as FakePosting[]) : [];
    const date = String(body.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return invalid("Dato mangler.", "date");
    if (state.closedBefore && date < state.closedBefore) return invalid("Perioden er lukket for bilagsføring.", "date");
    if (postings.length < 2) return invalid("Bilaget må ha minst to posteringer.", "postings");
    if (postings.reduce((s, p) => s + toMinor(p.amountGross), 0) !== 0) return invalid("Bilaget går ikke i balanse.", "postings");
    const made: FakePosting[] = [];
    for (const p of postings) {
      const account = state.accounts.find((a) => a.id === p.account?.id);
      if (!account || account.isInactive) return invalid("Kontoen finnes ikke eller er inaktiv.", "postings.account");
      if (account.requiresDepartment) return invalid("Avdeling må angis for denne kontoen.", "postings.department");
      if (account.ledgerType === "CUSTOMER" && !(p.customer && state.customers.has(p.customer.id))) return invalid("Kunde mangler.", "postings.customer");
      const vat = p.vatType ? state.vatTypes.find((v) => v.id === p.vatType!.id) : undefined;
      if (p.vatType && !vat) return invalid("Ugyldig mva-kode.", "postings.vatType");
      if (vat && account.legalVatTypes && account.legalVatTypes.length > 0 && !account.legalVatTypes.some((l) => l.id === vat.id)) {
        return invalid(`Mva-kode ${vat.number} er ikke tillatt på konto ${account.number}.`, "postings.vatType");
      }
      const gross = toMinor(p.amountGross);
      const net = gross - vatOfGross(gross, vat?.percentage ?? 0);
      made.push({ ...p, amount: net / 100 });
    }
    const id = ++nextId;
    const voucher: FakeVoucher = {
      id,
      version: 0,
      number: ++voucherNumber,
      year: Number(date.slice(0, 4)),
      date,
      description: String(body.description ?? ""),
      externalVoucherNumber: typeof body.externalVoucherNumber === "string" ? body.externalVoucherNumber : null,
      voucherType: (body.voucherType as { id: number } | undefined) ?? null,
      postings: made,
      attachments: 0,
    };
    state.vouchers.set(id, voucher);
    return answer(201, { value: voucher });
  }

  async function handle(method: string, url: URL, init: RequestInit | undefined): Promise<Response> {
    const path = decodeURIComponent(url.pathname).replace(/^\/v2/, "");
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Json) : {};

    if (method === "POST" && path === "/token/session/:createFromRefreshToken") {
      if (!state.apiTokens.has(String(body.refreshToken))) return answer(401, { status: 401, code: 3000, message: "Ugyldig token." });
      const token = `session-${++nextId}`;
      sessions.set(token, true);
      return answer(201, { value: { token } });
    }
    if (method === "POST" && path === "/token/session/:create") {
      if (!state.consumerTokens.has(String(body.consumerToken)) || !state.employeeTokens.has(String(body.employeeToken))) {
        return answer(403, { status: 403, code: 9000, message: "Ingen tilgang." });
      }
      const token = `session-${++nextId}`;
      sessions.set(token, true);
      return answer(201, { value: { token } });
    }

    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const [user, session] = Buffer.from(auth.replace(/^Basic /, ""), "base64").toString().split(":");
    if (user !== "0" || !sessions.has(session)) return answer(401, { status: 401, code: 3000, message: "Ikke innlogget." });

    if (method === "GET" && path === "/token/session/>whoAmI") return answer(200, { value: { companyId: state.company.id, company: state.company } });
    if (method === "GET" && path === "/ledger/account") {
      const number = url.searchParams.get("number");
      return list(state.accounts.filter((a) => !number || String(a.number) === number), url);
    }
    if (method === "GET" && path === "/ledger/vatType") return list(state.vatTypes, url);
    if (method === "GET" && path === "/ledger/voucherType") return list([{ id: 9, name: "Utgående faktura" }], url);
    if (method === "GET" && path === "/country") return list([{ id: 161, isoAlpha2Code: "NO" }, { id: 200, isoAlpha2Code: "SE" }], url);

    if (method === "GET" && path === "/customer") {
      const org = url.searchParams.get("organizationNumber");
      return list([...state.customers.values()].filter((c) => !org || c.organizationNumber === org), url);
    }
    if (method === "POST" && path === "/customer") {
      if (typeof body.name !== "string" || body.name.trim() === "") return invalid("Navn mangler.", "name");
      const id = ++nextId;
      const customer: FakeCustomer = { ...body, id, version: 0, name: body.name, customerNumber: 10000 + state.customers.size + 1 };
      state.customers.set(id, customer);
      return answer(201, { value: customer });
    }
    const customerPath = path.match(/^\/customer\/(\d+)$/);
    if (customerPath) {
      const customer = state.customers.get(Number(customerPath[1]));
      if (!customer) return answer(404, { status: 404, code: 6000, message: "Objektet finnes ikke." });
      if (method === "GET") return answer(200, { value: customer });
      if (method === "PUT") {
        if (body.version !== undefined && body.version !== customer.version) return answer(409, { status: 409, code: 8000, message: "Objektet er endret." });
        const updated: FakeCustomer = { ...customer, ...body, id: customer.id, version: customer.version + 1, customerNumber: customer.customerNumber };
        state.customers.set(customer.id, updated);
        return answer(200, { value: updated });
      }
    }

    if (method === "POST" && path === "/ledger/voucher") return postVoucher(body);
    if (method === "GET" && path === "/ledger/voucher/>externalVoucherNumber") {
      const key = url.searchParams.get("externalVoucherNumber");
      return list([...state.vouchers.values()].filter((v) => v.externalVoucherNumber === key), url);
    }
    const voucherPath = path.match(/^\/ledger\/voucher\/(\d+)(\/attachment)?$/);
    if (voucherPath) {
      const voucher = state.vouchers.get(Number(voucherPath[1]));
      if (!voucher) return answer(404, { status: 404, code: 6000, message: "Objektet finnes ikke." });
      if (method === "GET" && !voucherPath[2]) return answer(200, { value: voucher });
      if (method === "POST" && voucherPath[2]) {
        voucher.attachments += 1;
        return answer(201, { value: voucher });
      }
    }
    return answer(404, { status: 404, code: 6000, message: `No fake for ${method} ${path}` });
  }

  state.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = decodeURIComponent(url.pathname).replace(/^\/v2/, "");
    if (!["tripletex.no", "api-test.tripletex.tech"].includes(url.host)) throw new TypeError(`The fake Tripletex was called at ${url.host}`);
    const fail = failures.find((f) => f.method === method && f.path.test(path) && f.times > 0);
    if (fail) {
      fail.times -= 1;
      state.calls.push({ method, path, status: fail.status });
      return answer(fail.status, fail.body ?? { status: fail.status, code: 0, message: "Feil." }, fail.headers);
    }
    const response = await handle(method, url, init);
    const drop = lost.findIndex((l) => l.method === method && l.path.test(path));
    if (drop >= 0) {
      lost.splice(drop, 1);
      state.calls.push({ method, path, status: "lost" });
      throw new TypeError("fetch failed");
    }
    state.calls.push({ method, path, status: response.status });
    return response;
  }) as typeof fetch;

  return state;
}

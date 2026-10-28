import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.GOOGLE_CLIENT_ID = "123-test.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (jar.has(n) ? { value: jar.get(n) } : undefined), set: (n: string, v: string) => void jar.set(n, v), delete: (n: string) => void jar.delete(n) }),
  headers: async () => new Headers(),
}));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const google = await import("./google-sign-in");
const { GOOGLE_STATE_COOKIE } = await import("@/lib/google-sign-in");
const { newStore } = await import("./inventory-test-support");

/**
 * Sign in with Google against a stand-in for Google (D375): the start seals state for a real store's market, the callback exchanges the code
 * with the client's secret and the PKCE verifier, signs in only an account the store already has by its verified email (marking the email
 * proven), refuses a state that is not this browser's, a token for another client or nonce, and an email with no account, and the hand-over
 * on the store's host works once.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let store: Awaited<ReturnType<typeof newStore>>;
let market = "";
let customerId = "";
const EMAIL = `google-${run}@example.com`;

const jwt = (claims: Record<string, unknown>) => `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

/** The stand-in for Google's token endpoint: it answers with an ID token for the email given and records what it was sent. */
function standIn(claims: (nonce: string) => Record<string, unknown>) {
  const sent: URLSearchParams[] = [];
  let nonce = "";
  const fetch = (async (_url: unknown, init?: RequestInit) => {
    sent.push(new URLSearchParams(String(init?.body)));
    return new Response(JSON.stringify({ id_token: jwt(claims(nonce)), access_token: "x" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, sent, setNonce: (n: string) => void (nonce = n) };
}

async function begin() {
  const started = await google.startGoogle(store.slug, market);
  if (!started.ok) throw new Error("not started");
  const url = new URL(started.url);
  return { cookie: started.cookie, state: url.searchParams.get("state")!, nonce: url.searchParams.get("nonce")! };
}

const claimsFor = (email: string) => (nonce: string) => ({
  iss: "https://accounts.google.com",
  aud: process.env.GOOGLE_CLIENT_ID,
  exp: Math.floor(Date.now() / 1000) + 600,
  nonce,
  email,
  email_verified: true,
});

beforeAll(async () => {
  store = await newStore("google");
  market = store.member.store.markets[0].slug;
  const [c] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email) values (${store.storeId}::uuid, ${EMAIL}) returning id`);
  customerId = String(c.id);
});

afterAll(async () => {
  await closeDb();
});

describe("Sign in with Google", () => {
  it("is offered while the client exists, and starts on a real store's market only", async () => {
    expect(google.googleSignInOffered({ customerAccounts: "optional" })).toBe(true);
    expect(google.googleSignInOffered({ customerAccounts: "off" })).toBe(false);
    expect(await google.startGoogle("no-such-store-x", market)).toEqual({ ok: false });
    expect(google.googleStartUrl(store.slug, market)).toContain("/api/auth/google/start?");
  });

  it("signs in the store's account by its verified email, through a hand-over used once", async () => {
    const s = await begin();
    const g = standIn(claimsFor(EMAIL.toUpperCase()));
    g.setNonce(s.nonce);
    const to = await google.finishGoogle({ code: "code-1", state: s.state, cookie: s.cookie }, { fetch: g.fetch });
    // The code was exchanged with the client's secret and the verifier behind the challenge.
    expect(g.sent[0].get("client_secret")).toBe("test-secret");
    expect(g.sent[0].get("code")).toBe("code-1");
    expect(g.sent[0].get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const handover = new URL(to);
    expect(handover.pathname).toBe("/api/shop/google/enter");
    jar.clear();
    const landed = await google.enterGoogle(handover.searchParams.get("s"), handover.searchParams.get("m"), handover.searchParams.get("t"));
    expect(landed).toMatch(/\/account$/);
    expect([...jar.keys()]).toContain(`account_${store.storeId}`);
    const [c] = await db().execute<Row>(sql`select email_verified_at from commerce.customers where id = ${customerId}::uuid`);
    expect(c.email_verified_at).not.toBeNull();
    // The link is spent.
    expect(await google.enterGoogle(handover.searchParams.get("s"), handover.searchParams.get("m"), handover.searchParams.get("t"))).toMatch(/google=failed$/);
  });

  it("makes no account for an email the store does not have", async () => {
    const s = await begin();
    const g = standIn(claimsFor(`nobody-${run}@example.com`));
    g.setNonce(s.nonce);
    expect(await google.finishGoogle({ code: "c", state: s.state, cookie: s.cookie }, { fetch: g.fetch })).toMatch(/google=no_account$/);
    const [n] = await db().execute<Row>(sql`select count(*)::int as n from commerce.customers where store_id = ${store.storeId}::uuid and email = ${`nobody-${run}@example.com`}`);
    expect(n.n).toBe(0);
  });

  it("refuses another browser's state, another nonce, another client and an unverified email, asking Google nothing in the first case", async () => {
    const s = await begin();
    const other = await begin();
    const g = standIn(claimsFor(EMAIL));
    g.setNonce(s.nonce);
    expect(await google.finishGoogle({ code: "c", state: other.state, cookie: s.cookie }, { fetch: g.fetch })).toMatch(/google=failed$/);
    expect(g.sent).toHaveLength(0);
    g.setNonce("another-nonce");
    expect(await google.finishGoogle({ code: "c", state: s.state, cookie: s.cookie }, { fetch: g.fetch })).toMatch(/google=failed$/);
    const wrongClient = standIn((nonce) => ({ ...claimsFor(EMAIL)(nonce), aud: "other.apps.googleusercontent.com" }));
    wrongClient.setNonce(s.nonce);
    expect(await google.finishGoogle({ code: "c", state: s.state, cookie: s.cookie }, { fetch: wrongClient.fetch })).toMatch(/google=failed$/);
    const unverified = standIn((nonce) => ({ ...claimsFor(EMAIL)(nonce), email_verified: false }));
    unverified.setNonce(s.nonce);
    expect(await google.finishGoogle({ code: "c", state: s.state, cookie: s.cookie }, { fetch: unverified.fetch })).toMatch(/google=failed$/);
    // No cookie at all: back to Kaizena Flow's home, never to an address from the request.
    expect(await google.finishGoogle({ code: "c", state: s.state, cookie: undefined }, { fetch: g.fetch })).not.toContain("google=");
    expect(GOOGLE_STATE_COOKIE).toBe("kaizen_google");
  });
});

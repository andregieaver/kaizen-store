import { describe, expect, it } from "vitest";

import { listAll, openSession, whoAmI } from "./tripletex-client";
import { fakeTripletex } from "./tripletex-test-support";

/** Made-up tokens, put together here so secret scanners do not take them for real ones. */
const API_TOKEN = ["test-tlxr", "eyJhbGciOiJIUzI1NiJ9.e30.signature0123456789"].join("_");
const EMPLOYEE = ["test-", "eyJ0b2tlbklkIjo0Miwi", "dG9rZW4iOiJhYmMifQ=="].join("");
const CONSUMER = ["test-", "consumer-", "0123456789abcdef"].join("");

describe("Tripletex's API from one pasted token (D453)", () => {
  it("opens a session from the company's own API token, and reads which company it is", async () => {
    const tx = fakeTripletex();
    tx.apiTokens.add(API_TOKEN);
    const opened = await openSession({ kind: "api_token", mode: "test", token: API_TOKEN }, { fetch: tx.fetch });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(await whoAmI(opened.session)).toMatchObject({ ok: true, value: { id: 4242, name: "Human Web AS", organizationNumber: "912345678" } });
    expect(tx.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /token/session/:createFromRefreshToken", "GET /token/session/>whoAmI"]);
  });

  it("reads a session token Tripletex did not wrap in value, and a company whoAmI gives only the id of", async () => {
    const tx = fakeTripletex();
    tx.apiTokens.add(API_TOKEN);
    tx.shapes = { session: "bare", whoAmI: "id_only" };
    const opened = await openSession({ kind: "api_token", mode: "test", token: API_TOKEN }, { fetch: tx.fetch });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(await whoAmI(opened.session)).toMatchObject({ ok: true, value: { id: 4242, name: "Human Web AS", organizationNumber: "912345678" } });
    expect(tx.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /token/session/:createFromRefreshToken",
      "GET /token/session/>whoAmI",
      "GET /company/4242",
    ]);
  });

  it("says Tripletex's answer could not be read when it carries no session token, or no company it can name", async () => {
    const tx = fakeTripletex();
    tx.apiTokens.add(API_TOKEN);
    const empty: typeof fetch = async () => new Response(JSON.stringify({ value: { id: 1 } }), { status: 201, headers: { "content-type": "application/json" } });
    expect(await openSession({ kind: "api_token", mode: "test", token: API_TOKEN }, { fetch: empty })).toMatchObject({ ok: false, failure: { key: "bad_answer", class: "transient" } });
    const html: typeof fetch = async () => new Response("<!doctype html><title>Tripletex</title>", { status: 200, headers: { "content-type": "text/html" } });
    expect(await openSession({ kind: "api_token", mode: "test", token: API_TOKEN }, { fetch: html })).toMatchObject({ ok: false, failure: { key: "bad_answer" } });

    tx.shapes.whoAmI = "id_only";
    const opened = await openSession({ kind: "api_token", mode: "test", token: API_TOKEN }, { fetch: tx.fetch });
    if (!opened.ok) throw new Error("no session");
    tx.failNext("GET", /^\/company\/4242$/, 403);
    expect(await whoAmI(opened.session)).toMatchObject({ ok: false, failure: { key: "bad_answer" } });
  });

  it("opens a session from an employee token with Kaizena Flow's consumer token, and says so when there is none", async () => {
    const tx = fakeTripletex();
    tx.employeeTokens.add(EMPLOYEE);
    tx.consumerTokens.add(CONSUMER);
    const opened = await openSession({ kind: "employee_token", mode: "test", token: EMPLOYEE }, { fetch: tx.fetch, consumerToken: () => CONSUMER });
    expect(opened.ok).toBe(true);
    const without = await openSession({ kind: "employee_token", mode: "test", token: EMPLOYEE }, { fetch: tx.fetch, consumerToken: () => null });
    expect(without).toMatchObject({ ok: false, failure: { key: "no_consumer_token" } });
  });

  it("calls a token Tripletex refuses a sign-in failure, whatever status it answered", async () => {
    const tx = fakeTripletex();
    const refused = await openSession({ kind: "api_token", mode: "test", token: API_TOKEN }, { fetch: tx.fetch });
    expect(refused).toMatchObject({ ok: false, failure: { class: "auth", key: "http_401" } });
    tx.employeeTokens.add(EMPLOYEE);
    const wrongConsumer = await openSession({ kind: "employee_token", mode: "test", token: EMPLOYEE }, { fetch: tx.fetch, consumerToken: () => CONSUMER });
    expect(wrongConsumer).toMatchObject({ ok: false, failure: { class: "auth" } });
  });

  it("keeps the session token out of every answer and sends it only as the password of company 0", async () => {
    const tx = fakeTripletex();
    tx.apiTokens.add(API_TOKEN);
    const seen: string[] = [];
    const watching: typeof fetch = async (input, init) => {
      seen.push(new Headers(init?.headers).get("authorization") ?? "");
      return tx.fetch(input, init);
    };
    const opened = await openSession({ kind: "api_token", mode: "test", token: API_TOKEN }, { fetch: watching });
    if (!opened.ok) throw new Error("no session");
    expect(JSON.stringify(opened)).not.toContain("session-");
    await whoAmI(opened.session);
    expect(seen[0]).toBe("");
    expect(Buffer.from(seen[1].replace("Basic ", ""), "base64").toString()).toMatch(/^0:session-\d+$/);
  });

  it("goes only to Tripletex's own two addresses, chosen by the token's environment", async () => {
    const hosts: string[] = [];
    const tx = fakeTripletex();
    tx.apiTokens.add(API_TOKEN);
    const watching: typeof fetch = async (input, init) => {
      hosts.push(new URL(String(input)).host);
      return tx.fetch(input, init);
    };
    await openSession({ kind: "api_token", mode: "test", token: API_TOKEN }, { fetch: watching });
    await openSession({ kind: "api_token", mode: "live", token: API_TOKEN }, { fetch: watching });
    expect(hosts).toEqual(["api-test.tripletex.tech", "tripletex.no"]);
  });

  it("turns a timeout, a redirect, a rate limit and Tripletex being down into failures, never a thrown error", async () => {
    const tx = fakeTripletex();
    tx.apiTokens.add(API_TOKEN);
    const opened = await openSession({ kind: "api_token", mode: "test", token: API_TOKEN }, { fetch: tx.fetch });
    if (!opened.ok) throw new Error("no session");
    tx.failNext("GET", /^\/ledger\/account$/, 429, {}, { "x-rate-limit-reset": "30" });
    expect(await opened.session.get("/ledger/account")).toMatchObject({ ok: false, failure: { class: "rate_limit", retryAfter: 30 } });
    tx.failNext("GET", /^\/ledger\/account$/, 503);
    expect(await opened.session.get("/ledger/account")).toMatchObject({ ok: false, failure: { class: "transient" } });
    tx.failNext("GET", /^\/ledger\/account$/, 302);
    expect(await opened.session.get("/ledger/account")).toMatchObject({ ok: false, failure: { key: "redirect" } });
    tx.loseAnswer("GET", /^\/ledger\/account$/);
    expect(await opened.session.get("/ledger/account")).toMatchObject({ ok: false, failure: { class: "transient", key: "network" } });
    const slow: typeof fetch = async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    };
    expect(await openSession({ kind: "api_token", mode: "test", token: API_TOKEN }, { fetch: slow })).toMatchObject({ ok: false, failure: { key: "timeout", class: "transient" } });
  });

  it("refuses a path that is not one of the code's own", async () => {
    const tx = fakeTripletex();
    tx.apiTokens.add(API_TOKEN);
    const opened = await openSession({ kind: "api_token", mode: "test", token: API_TOKEN }, { fetch: tx.fetch });
    if (!opened.ok) throw new Error("no session");
    expect(() => opened.session.get("/../admin")).toThrow();
    expect(() => opened.session.get("https://evil.example/v2")).toThrow();
    expect(() => opened.session.get("/customer?id=1")).toThrow();
  });

  it("reads a whole list a page at a time", async () => {
    const tx = fakeTripletex();
    tx.apiTokens.add(API_TOKEN);
    for (let i = 0; i < 1500; i += 1) tx.accounts.push({ id: 900000 + i, number: 40000 + i, name: `Konto ${i}` });
    const opened = await openSession({ kind: "api_token", mode: "test", token: API_TOKEN }, { fetch: tx.fetch });
    if (!opened.ok) throw new Error("no session");
    const all = await listAll<{ number: number }>(opened.session, "/ledger/account");
    expect(all.ok && all.value.length).toBe(1500 + 6);
    expect(tx.calls.filter((c) => c.path === "/ledger/account")).toHaveLength(2);
  });
});

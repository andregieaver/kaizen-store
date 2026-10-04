import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { VIES_HOST, VIES_URL } from "@/lib/vies";

import { checkVatNumber, viesAddress } from "./vies";

const reply = (status: number, body: unknown = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const valid = { valid: true, name: "ACME AB", address: "STORGATAN 1\n111 22 STOCKHOLM", requestIdentifier: "WAPIAAAAZ1" };

afterEach(() => vi.unstubAllEnvs());

describe("the VIES call (D157)", () => {
  it("asks the one fixed address, with a body made only of the country code and the number", async () => {
    const fetcher = vi.fn(async () => reply(200, valid));
    const answer = await checkVatNumber("DE123456789", null, { fetch: fetcher });
    expect(answer).toMatchObject({ status: "valid", name: "ACME AB", requestIdentifier: "WAPIAAAAZ1" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(VIES_URL);
    expect(new URL(url).host).toBe(VIES_HOST);
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(String(init.body))).toEqual({ countryCode: "DE", vatNumber: "123456789" });
  });

  it("adds the store's own number as the requester, so the answer carries a consultation number", async () => {
    const fetcher = vi.fn(async () => reply(200, valid));
    await checkVatNumber("DE123456789", "SE556677889901", { fetch: fetcher });
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      countryCode: "DE",
      vatNumber: "123456789",
      requesterMemberStateCode: "SE",
      requesterNumber: "556677889901",
    });
  });

  it("leaves a requester that is not a member state's out of the request", async () => {
    const fetcher = vi.fn(async () => reply(200, valid));
    await checkVatNumber("DE123456789", "NO923609016MVA", { fetch: fetcher });
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ countryCode: "DE", vatNumber: "123456789" });
  });

  it("never asks about a number that is not a member state's", async () => {
    const fetcher = vi.fn();
    for (const number of ["NO923609016MVA", "GB123456789", "XI123456789", "nonsense", "DE1"]) {
      expect(await checkVatNumber(number, null, { fetch: fetcher })).toMatchObject({ status: "invalid", error: "not_a_member_number" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stores `---` (not disclosed) as null", async () => {
    const fetcher = vi.fn(async () => reply(200, { valid: true, name: "---", address: "---", requestIdentifier: "" }));
    expect(await checkVatNumber("DE123456789", null, { fetch: fetcher })).toMatchObject({ status: "valid", name: null, address: null, requestIdentifier: null });
  });

  it("does not repeat a definite answer: not valid is final", async () => {
    const fetcher = vi.fn(async () => reply(200, { valid: false }));
    expect(await checkVatNumber("DE123456789", null, { fetch: fetcher })).toMatchObject({ status: "invalid" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("tries once more after a 5xx answer, and believes the second", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(503, "down")).mockResolvedValueOnce(reply(200, valid));
    expect(await checkVatNumber("DE123456789", null, { fetch: fetcher })).toMatchObject({ status: "valid" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("is unavailable after two failures, with the short code, and never valid", async () => {
    const fetcher = vi.fn(async () => reply(500, { error: "x" }));
    expect(await checkVatNumber("DE123456789", null, { fetch: fetcher })).toMatchObject({ status: "unavailable", error: "http_500" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("times out (4 seconds by default) and retries once", async () => {
    // A fetch that never answers but gives up when its signal fires, as the platform's does.
    const hanging = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new DOMException("aborted", "AbortError")));
    }));
    const answer = await checkVatNumber("DE123456789", null, { fetch: hanging as unknown as typeof fetch, timeoutMs: 25 });
    expect(answer).toMatchObject({ status: "unavailable", error: "timeout" });
    expect(hanging).toHaveBeenCalledTimes(2);
  });

  it("is unavailable when the network fails, after one retry", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await checkVatNumber("DE123456789", null, { fetch: fetcher as unknown as typeof fetch })).toMatchObject({ status: "unavailable", error: "network" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("is unavailable for an answer that is not JSON, without a retry", async () => {
    const fetcher = vi.fn(async () => reply(200, "<html>maintenance</html>"));
    expect(await checkVatNumber("DE123456789", null, { fetch: fetcher })).toMatchObject({ status: "unavailable", error: "malformed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not believe a valid answer that carries the service's own error", async () => {
    const fetcher = vi.fn(async () => reply(200, { ...valid, userError: "MS_UNAVAILABLE" }));
    expect(await checkVatNumber("DE123456789", null, { fetch: fetcher })).toMatchObject({ status: "unavailable" });
  });

  it("reads at most 16 KB of an answer", async () => {
    const fetcher = vi.fn(async () => reply(200, JSON.stringify({ valid: true, name: "x".repeat(40_000) })));
    // Cut at 16 KB the JSON is no longer JSON: unavailable, never a guess.
    expect(await checkVatNumber("DE123456789", null, { fetch: fetcher })).toMatchObject({ status: "unavailable", error: "malformed" });
  });
});

describe("the address", () => {
  it("is VIES's, unless the test switch is on", () => {
    expect(viesAddress()).toBe(VIES_URL);
    vi.stubEnv("VIES_TEST_URL", "http://127.0.0.1:9999/check");
    expect(viesAddress()).toBe(VIES_URL);
  });

  it("honours a test server only with the switch on and never on Vercel", () => {
    vi.stubEnv("VIES_TEST_URL", "http://127.0.0.1:9999/check");
    vi.stubEnv("VIES_ALLOW_TEST_URL", "1");
    vi.stubEnv("VERCEL", "");
    expect(viesAddress()).toBe("http://127.0.0.1:9999/check");
    vi.stubEnv("VERCEL", "1");
    expect(viesAddress()).toBe(VIES_URL);
  });

  it("is used when the caller gives none", async () => {
    vi.stubEnv("VIES_TEST_URL", "http://127.0.0.1:9999/check");
    vi.stubEnv("VIES_ALLOW_TEST_URL", "1");
    vi.stubEnv("VERCEL", "");
    const fetcher = vi.fn(async () => reply(200, valid));
    await checkVatNumber("DE123456789", null, { fetch: fetcher });
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe("http://127.0.0.1:9999/check");
  });
});

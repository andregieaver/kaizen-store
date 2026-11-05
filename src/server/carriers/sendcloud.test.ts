import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSendcloudAdapter, readSenders } from "./sendcloud";

const context = (details: Record<string, string> = {}, secrets: Record<string, string> = { secretKey: "sec" }) => ({
  storeId: "s",
  environment: "test" as const,
  details: { publicKey: "pub", senderAddressId: "1", ...details },
  secrets,
});
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const address = (id: number, city: string) => ({ id, name: "Gerda", company_name: "Gerdas Laden", address_line_1: "Hauptstraße", house_number: "1", postal_code: "10115", city, country_code: "DE" });
const page = `https://panel.sendcloud.sc/api/v3/addresses/sender-addresses`;

/** A stand-in for Sendcloud: answers the sender addresses with what `answers` gives, page by page. */
function sendcloud(answers: Response[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), headers: (init.headers ?? {}) as Record<string, string> });
    return answers.shift() ?? json({}, 404);
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

afterEach(() => vi.unstubAllEnvs());

describe("Sendcloud's connection (D454 step 1)", () => {
  it("checks the keys with a harmless read of the sender addresses, on API v3 with Basic auth", async () => {
    const s = sendcloud([json({ data: [address(1, "Berlin")] })]);
    expect(await createSendcloudAdapter(s.fetcher).check(context())).toEqual({ ok: true });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].url).toBe(`${page}?page_size=100`);
    expect(s.calls[0].headers.Authorization).toBe(`Basic ${Buffer.from("pub:sec").toString("base64")}`);
    expect(s.calls[0].headers["Sendcloud-Partner-Id"]).toBeUndefined();
  });

  it("sends Flow's partner id once one is set", async () => {
    vi.stubEnv("SENDCLOUD_PARTNER_ID", "0f0f0f0f-0000-4000-8000-000000000000");
    const s = sendcloud([json({ data: [address(1, "Berlin")] })]);
    await createSendcloudAdapter(s.fetcher).check(context());
    expect(s.calls[0].headers["Sendcloud-Partner-Id"]).toBe("0f0f0f0f-0000-4000-8000-000000000000");
  });

  it("says plainly when the keys are refused, missing, or Sendcloud does not answer", async () => {
    expect(await createSendcloudAdapter(sendcloud([json({ errors: [{ status: 401, code: "not_authenticated" }] }, 401)]).fetcher).check(context())).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/did not accept these keys/),
    });
    const none = sendcloud([]);
    expect(await createSendcloudAdapter(none.fetcher).check(context({}, {}))).toMatchObject({ ok: false, problem: expect.stringMatching(/Save the public and secret key/) });
    expect(none.calls).toHaveLength(0);
    const down = vi.fn(async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    expect(await createSendcloudAdapter(down).check(context())).toMatchObject({ ok: false, problem: expect.stringMatching(/did not answer/) });
  });

  it("is not satisfied until a sender address is chosen and still in the account", async () => {
    const adapter = (body: unknown) => createSendcloudAdapter(sendcloud([json(body)]).fetcher);
    expect(await adapter({ data: [address(1, "Berlin")] }).check(context({ senderAddressId: "" }))).toMatchObject({ ok: false, problem: expect.stringMatching(/choose the sender/) });
    expect(await adapter({ data: [address(1, "Berlin")] }).check(context({ senderAddressId: "7" }))).toMatchObject({ ok: false, problem: expect.stringMatching(/no longer/) });
    expect(await adapter({ data: [] }).check(context())).toMatchObject({ ok: false, problem: expect.stringMatching(/no sender address yet/) });
    expect(await adapter({ unexpected: true }).check(context())).toMatchObject({ ok: false, problem: expect.stringMatching(/not with a list/) });
  });

  it("reads every page of sender addresses through the Link header, and never follows one off Sendcloud's host", async () => {
    const second = `${page}?cursor=abc&page_size=100`;
    const s = sendcloud([json({ data: [address(1, "Berlin")] }, 200, { link: `<${second}>; rel="next"` }), json({ data: [address(2, "Hamburg")] })]);
    expect(await readSenders(context(), s.fetcher)).toEqual({
      ok: true,
      senders: [
        { id: "1", label: "Gerdas Laden, Hauptstraße 1, 10115 Berlin, DE", country: "DE" },
        { id: "2", label: "Gerdas Laden, Hauptstraße 1, 10115 Hamburg, DE", country: "DE" },
      ],
    });
    expect(s.calls.map((c) => c.url)).toEqual([`${page}?page_size=100`, second]);
    const off = sendcloud([json({ data: [address(1, "Berlin")] }, 200, { link: '<https://evil.example/x>; rel="next"' })]);
    await readSenders(context(), off.fetcher);
    expect(off.calls).toHaveLength(1);
  });
});

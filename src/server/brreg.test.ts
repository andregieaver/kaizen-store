import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// `'use cache'` needs Next's runtime; the calls under test are the same without it.
vi.mock("next/cache", () => ({ cacheLife: () => {} }));

import { lookupCompany, searchCompanies } from "./brreg";

const unit = {
  organisasjonsnummer: "923609016",
  navn: "EQUINOR ASA",
  organisasjonsform: { kode: "ASA", beskrivelse: "Allmennaksjeselskap" },
  registrertIMvaregisteret: true,
  forretningsadresse: { adresse: ["Forusbeen 50"], postnummer: "4035", poststed: "STAVANGER" },
};

const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("looking a company up", () => {
  it("asks the register for the nine digits only, at its fixed address", async () => {
    const fetcher = vi.fn(async () => reply(200, unit));
    vi.stubGlobal("fetch", fetcher);
    const result = await lookupCompany("NO 923 609 016 MVA");
    expect(result.ok && result.company.legalName).toBe("EQUINOR ASA");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://data.brreg.no/enhetsregisteret/api/enheter/923609016");
    expect(new Headers(init.headers).get("accept")).toBe("application/json");
  });

  it("refuses a bad number without any call", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const bad of ["", "12", "923609017", "Equinor"]) {
      expect(await lookupCompany(bad)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("says not found for an unknown or removed unit", async () => {
    for (const status of [404, 410]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => reply(status)),
      );
      expect(await lookupCompany("923609016")).toEqual({ ok: false, reason: "not_found" });
    }
  });

  it("says unavailable when the register fails or does not answer, never throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply(503)),
    );
    expect(await lookupCompany("923609016")).toEqual({ ok: false, reason: "unavailable" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new DOMException("timed out", "TimeoutError"))),
    );
    expect(await lookupCompany("923609016")).toEqual({ ok: false, reason: "unavailable" });
  });

  it("does not take an answer that is not a company as one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply(200, { hello: "world" })),
    );
    expect(await lookupCompany("923609016")).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("searching by name", () => {
  const found = {
    _embedded: {
      enheter: [{ organisasjonsnummer: "915262341", navn: "MAGNAT KAFFEHUS AS", organisasjonsform: { kode: "AS" } }],
    },
    page: { totalElements: 12 },
  };

  it("sends the words, encoded, and asks for a handful", async () => {
    const fetcher = vi.fn(async () => reply(200, found));
    vi.stubGlobal("fetch", fetcher);
    const result = await searchCompanies("Kaffehus & Co");
    expect(result).toMatchObject({ ok: true, total: 12 });
    expect(result.ok && result.hits[0]?.organisationNumber).toBe("915262341");
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://data.brreg.no/enhetsregisteret/api/enheter?navn=Kaffehus%20%26%20Co&size=8",
    );
  });

  it("needs a couple of letters, and a number is not a name", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await searchCompanies("a")).toEqual({ ok: false, reason: "too_short" });
    expect(await searchCompanies("923609016")).toEqual({ ok: false, reason: "too_short" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("finds nothing without failing, and reports a broken register", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply(200, { page: { totalElements: 0 } })),
    );
    expect(await searchCompanies("Nothing Here")).toEqual({ ok: true, hits: [], total: 0 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply(500)),
    );
    expect(await searchCompanies("Kaffehus")).toEqual({ ok: false, reason: "unavailable" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    );
    expect(await searchCompanies("Kaffehus")).toEqual({ ok: false, reason: "unavailable" });
  });
});

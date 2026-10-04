import { describe, expect, it, vi } from "vitest";

import { ECB_HIST_90D_URL, ECB_HIST_URL, MAX_ECB_BYTES, isEcbUrl } from "@/lib/ecb-history";

vi.mock("server-only", () => ({}));

const { ecbText, latestRates, ratesNearDay } = await import("./ecb-fetch");

/** A cut of the real 90-day feed (read 2026-10-04): 30 September holds NOK 10.9015, SEK 11.331, DKK 7.4755. */
const XML = `<?xml version="1.0"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube><Cube time="2026-10-02"><Cube currency="DKK" rate="7.4736"/><Cube currency="SEK" rate="11.29"/></Cube><Cube time="2026-09-30"><Cube currency="DKK" rate="7.4755"/><Cube currency="SEK" rate="11.331"/><Cube currency="NOK" rate="10.9015"/></Cube></Cube></gesmes:Envelope>`;
const CSV = ["KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS", "EXR.D.DKK.EUR.SP00.A,D,DKK,EUR,SP00,A,2026-09-30,7.4755,A"].join("\r\n");

type Call = { url: string; signal: AbortSignal; cache: string };
/** A fetch that answers by address and records every request made. */
function fetcher(answers: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fn = async (url: string, init: { signal: AbortSignal; cache: "no-store" }) => {
    calls.push({ url, signal: init.signal, cache: init.cache });
    const make = Object.entries(answers).find(([prefix]) => url.startsWith(prefix))?.[1];
    return make ? make() : new Response("not found", { status: 404 });
  };
  return { fn, calls };
}

describe("asking the ECB", () => {
  it("makes no request to anything but the ECB's own hosts, and never throws", async () => {
    const f = fetcher({ "": () => new Response("x") });
    expect(await ecbText("https://example.com/eurofxref-hist-90d.xml", f.fn)).toBeNull();
    expect(await ecbText("http://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml", f.fn)).toBeNull();
    expect(await ecbText("https://www.ecb.europa.eu.evil.example/x", f.fn)).toBeNull();
    expect(f.calls).toEqual([]);
  });

  it("asks with a timeout and no cache, and reads the answer as text", async () => {
    const f = fetcher({ [ECB_HIST_90D_URL]: () => new Response(XML) });
    expect(await ecbText(ECB_HIST_90D_URL, f.fn)).toBe(XML);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].cache).toBe("no-store");
    expect(f.calls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("treats anything but a 200, a failure or a too-big answer as unavailable", async () => {
    for (const make of [
      () => new Response("down", { status: 503 }),
      () => new Response("", { status: 204 }),
      () => new Response("x", { status: 200, headers: { "content-length": String(MAX_ECB_BYTES + 1) } }),
      () => new Response("x".repeat(MAX_ECB_BYTES + 5)),
    ]) {
      expect(await ecbText(ECB_HIST_90D_URL, fetcher({ "": make }).fn)).toBeNull();
    }
    const failing = async () => {
      throw new Error("socket hang up");
    };
    expect(await ecbText(ECB_HIST_90D_URL, failing)).toBeNull();
    expect(await latestRates(failing)).toBeNull();
  });

  it("reads the latest ninety days as rates, and a page that is not the feed as unavailable", async () => {
    const rates = await latestRates(fetcher({ [ECB_HIST_90D_URL]: () => new Response(XML) }).fn);
    expect(rates).toContainEqual({ date: "2026-09-30", currency: "DKK", rate: "7.4755" });
    expect(rates).toHaveLength(5);
    expect(await latestRates(fetcher({ [ECB_HIST_90D_URL]: () => new Response("<html>maintenance</html>") }).fn)).toBeNull();
  });
});

describe("the rates of one currency near a day", () => {
  it("asks the data portal first, for that currency and a week, and goes no further when it answers", async () => {
    const f = fetcher({ "https://data-api.ecb.europa.eu/": () => new Response(CSV) });
    const found = await ratesNearDay("DKK", "2026-09-30", "2026-10-04", f.fn);
    expect(found).toEqual({ via: "portal", rates: [{ date: "2026-09-30", currency: "DKK", rate: "7.4755" }] });
    expect(f.calls.map((c) => c.url)).toEqual(["https://data-api.ecb.europa.eu/service/data/EXR/D.DKK.EUR.SP00.A?startPeriod=2026-09-30&endPeriod=2026-10-07&format=csvdata"]);
  });

  it("falls back to the 90-day feed for a recent day and to the full history for an older one, keeping only the wanted currency", async () => {
    const recent = fetcher({ [ECB_HIST_90D_URL]: () => new Response(XML) });
    expect(await ratesNearDay("DKK", "2026-09-30", "2026-10-04", recent.fn)).toEqual({
      via: "feed_90d",
      rates: [
        { date: "2026-10-02", currency: "DKK", rate: "7.4736" },
        { date: "2026-09-30", currency: "DKK", rate: "7.4755" },
      ],
    });
    expect(recent.calls.map((c) => c.url.split("?")[0])).toEqual(["https://data-api.ecb.europa.eu/service/data/EXR/D.DKK.EUR.SP00.A", ECB_HIST_90D_URL]);

    const old = fetcher({ [ECB_HIST_URL]: () => new Response(XML) });
    expect(await ratesNearDay("SEK", "2026-09-30", "2027-06-01", old.fn)).toEqual({
      via: "feed_all",
      rates: [
        { date: "2026-10-02", currency: "SEK", rate: "11.29" },
        { date: "2026-09-30", currency: "SEK", rate: "11.331" },
      ],
    });
    expect(old.calls.every((c) => isEcbUrl(c.url))).toBe(true);
    expect(old.calls.map((c) => c.url)).not.toContain(ECB_HIST_90D_URL);
  });

  it("is unavailable when nothing answers, and refuses a currency the portal's address cannot be made for", async () => {
    expect(await ratesNearDay("DKK", "2026-09-30", "2026-10-04", fetcher({ "": () => new Response("down", { status: 503 }) }).fn)).toBeNull();
    const f = fetcher({ "": () => new Response(XML) });
    expect(await ratesNearDay("EUR", "2026-09-30", "2026-10-04", f.fn)).toBeNull();
    expect(await ratesNearDay("dkk; drop", "2026-09-30", "2026-10-04", f.fn)).toBeNull();
    expect(f.calls).toEqual([]);
  });
});

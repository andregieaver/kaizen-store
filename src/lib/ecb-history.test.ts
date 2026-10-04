import { describe, expect, it } from "vitest";

import {
  ECB_HIST_90D_URL,
  ECB_HIST_URL,
  MAX_ECB_BYTES,
  easterSunday,
  ecbPortalUrl,
  ecbRateFor,
  isEcbPublicationDay,
  isEcbUrl,
  nextPublicationDay,
  parseEcbCsv,
  parseEcbHistory,
  rateScaled,
  toEuroMinor,
  type EcbRate,
} from "./ecb-history";

// A cut of the real 90-day feed (read 2026-10-04): the 2026-09-30 row holds NOK 10.9015, SEK 11.331, DKK 7.4755.
const XML = `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><gesmes:subject>Reference rates</gesmes:subject><gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender><Cube><Cube time="2026-10-02"><Cube currency="USD" rate="1.1225"/><Cube currency="DKK" rate="7.4736"/><Cube currency="SEK" rate="11.29"/><Cube currency="NOK" rate="10.8315"/></Cube><Cube time="2026-09-30"><Cube currency="USD" rate="1.1190"/><Cube currency="DKK" rate="7.4755"/><Cube currency="SEK" rate="11.331"/><Cube currency="NOK" rate="10.9015"/><Cube currency="GBP" rate="0.85463"/></Cube></Cube></gesmes:Envelope>`;

describe("the ECB's feeds", () => {
  it("parses the 90-day XML into days, currencies and decimal rates", () => {
    const rates = parseEcbHistory(XML)!;
    expect(rates).toHaveLength(9);
    expect(rates).toContainEqual({ date: "2026-09-30", currency: "NOK", rate: "10.9015" });
    expect(rates).toContainEqual({ date: "2026-09-30", currency: "SEK", rate: "11.331" });
    expect(rates).toContainEqual({ date: "2026-09-30", currency: "DKK", rate: "7.4755" });
    expect(rates).toContainEqual({ date: "2026-09-30", currency: "GBP", rate: "0.85463" });
  });

  it("keeps only the wanted days of a long file", () => {
    const rates = parseEcbHistory(XML, new Set(["2026-09-30"]))!;
    expect(new Set(rates.map((r) => r.date))).toEqual(new Set(["2026-09-30"]));
    expect(rates).toHaveLength(5);
    expect(parseEcbHistory(XML, new Set(["2020-01-01"]))).toEqual([]);
  });

  it("is unavailable when it holds no day, is empty or is too big, and skips rows that do not parse", () => {
    expect(parseEcbHistory("")).toBeNull();
    expect(parseEcbHistory("<html>Service unavailable</html>")).toBeNull();
    expect(parseEcbHistory("x".repeat(MAX_ECB_BYTES + 1))).toBeNull();
    const odd = parseEcbHistory(`<Cube time="2026-09-30"><Cube currency="DKK" rate="abc"/><Cube currency="SEK" rate="0"/><Cube currency="EUR" rate="1"/><Cube currency="NOK" rate="10.9015"/><Cube currency="HUF" rate="1.1234567"/></Cube>`)!;
    expect(odd).toEqual([{ date: "2026-09-30", currency: "NOK", rate: "10.9015" }]);
  });

  it("parses the data portal's CSV for one currency", () => {
    const csv = [
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS",
      "EXR.D.NOK.EUR.SP00.A,D,NOK,EUR,SP00,A,2026-09-29,10.9,A",
      "EXR.D.NOK.EUR.SP00.A,D,NOK,EUR,SP00,A,2026-09-30,10.9015,A",
      "",
    ].join("\r\n");
    expect(parseEcbCsv(csv)).toEqual([
      { date: "2026-09-29", currency: "NOK", rate: "10.9" },
      { date: "2026-09-30", currency: "NOK", rate: "10.9015" },
    ]);
    expect(parseEcbCsv("TIME_PERIOD,OBS_VALUE\n2026-09-30,10.9015", "NOK")).toEqual([{ date: "2026-09-30", currency: "NOK", rate: "10.9015" }]);
  });

  it("treats an answer that is not the expected CSV as unavailable", () => {
    expect(parseEcbCsv("")).toBeNull();
    expect(parseEcbCsv("<html>503</html>")).toBeNull();
    expect(parseEcbCsv("TIME_PERIOD,OBS_VALUE\n2026-09-30,10.9015")).toBeNull(); // no currency anywhere
    expect(parseEcbCsv("A,B\n1,2", "NOK")).toBeNull();
    expect(parseEcbCsv("TIME_PERIOD,OBS_VALUE\n2026-09-30,\n2026-09-31x,10", "NOK")).toEqual([]);
  });

  it("only ever names the ECB's own hosts", () => {
    expect(isEcbUrl(ECB_HIST_90D_URL)).toBe(true);
    expect(isEcbUrl(ECB_HIST_URL)).toBe(true);
    expect(isEcbUrl(ecbPortalUrl("NOK", "2026-09-28", "2026-10-05"))).toBe(true);
    expect(ecbPortalUrl("NOK", "2026-09-28", "2026-10-05")).toBe("https://data-api.ecb.europa.eu/service/data/EXR/D.NOK.EUR.SP00.A?startPeriod=2026-09-28&endPeriod=2026-10-05&format=csvdata");
    expect(isEcbUrl("https://evil.example/stats/eurofxref/eurofxref-hist-90d.xml")).toBe(false);
    expect(isEcbUrl("https://www.ecb.europa.eu.evil.example/")).toBe(false);
    expect(isEcbUrl("http://www.ecb.europa.eu/x")).toBe(false);
    expect(isEcbUrl("not a url")).toBe(false);
  });

  it("refuses to build a portal address from anything but a currency and two days", () => {
    expect(() => ecbPortalUrl("nok", "2026-09-28", "2026-09-30")).toThrow(RangeError);
    expect(() => ecbPortalUrl("NOK/../x", "2026-09-28", "2026-09-30")).toThrow(RangeError);
    expect(() => ecbPortalUrl("EUR", "2026-09-28", "2026-09-30")).toThrow(RangeError);
    expect(() => ecbPortalUrl("NOK", "2026-09-28&x=1", "2026-09-30")).toThrow(RangeError);
    expect(() => ecbPortalUrl("NOK", "2026-09-30", "2026-09-28")).toThrow(RangeError);
  });
});

describe("publication days", () => {
  it("computes Easter", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2024)).toBe("2024-03-31");
  });

  it("are working days except the TARGET closing days", () => {
    expect(isEcbPublicationDay("2026-09-30")).toBe(true); // Wednesday
    expect(isEcbPublicationDay("2026-10-03")).toBe(false); // Saturday
    expect(isEcbPublicationDay("2026-10-04")).toBe(false); // Sunday
    expect(isEcbPublicationDay("2026-01-01")).toBe(false);
    expect(isEcbPublicationDay("2026-04-03")).toBe(false); // Good Friday
    expect(isEcbPublicationDay("2026-04-06")).toBe(false); // Easter Monday
    expect(isEcbPublicationDay("2026-04-07")).toBe(true);
    expect(isEcbPublicationDay("2026-05-01")).toBe(false);
    expect(isEcbPublicationDay("2026-12-25")).toBe(false);
    expect(isEcbPublicationDay("2026-12-26")).toBe(false);
    expect(isEcbPublicationDay("2026-12-24")).toBe(true);
    expect(isEcbPublicationDay("2026-12-31")).toBe(true);
  });

  it("find the next one, over a weekend and over a closing run", () => {
    expect(nextPublicationDay("2026-09-30")).toBe("2026-09-30");
    expect(nextPublicationDay("2026-10-03")).toBe("2026-10-05");
    expect(nextPublicationDay("2026-12-25")).toBe("2026-12-28"); // Fri 25, Sat 26 closed
    expect(nextPublicationDay("2026-04-03")).toBe("2026-04-07"); // Good Friday, weekend, Easter Monday
    expect(nextPublicationDay("2026-12-31")).toBe("2026-12-31");
  });
});

describe("the rate of a day", () => {
  const stored: EcbRate[] = parseEcbHistory(XML)!;

  it("is the day's own reference rate", () => {
    expect(ecbRateFor(stored, "DKK", "2026-09-30")).toEqual({ rate: "7.4755", date: "2026-09-30" });
    expect(ecbRateFor(stored, "NOK", "2026-09-30")).toEqual({ rate: "10.9015", date: "2026-09-30" });
  });

  it("is the next day of publication when the last day has none (a quarter ending on a Sunday)", () => {
    const rates: EcbRate[] = [
      { date: "2026-12-28", currency: "SEK", rate: "11.5" },
      { date: "2026-12-24", currency: "SEK", rate: "11.4" },
    ];
    // 31 December 2028 is a Sunday; the next publication day is Monday 1 January, a closing day, so Tuesday 2 January 2029.
    const sunday: EcbRate[] = [{ date: "2029-01-02", currency: "SEK", rate: "11.6" }, { date: "2028-12-29", currency: "SEK", rate: "11.0" }];
    expect(ecbRateFor(sunday, "SEK", "2028-12-31")).toEqual({ rate: "11.6", date: "2029-01-02" });
    expect(ecbRateFor(rates, "SEK", "2026-12-26")).toEqual({ rate: "11.5", date: "2026-12-28" });
  });

  it("is null when the day is not stored: not yet published, a missing fetch, or a currency the ECB does not publish", () => {
    expect(ecbRateFor(stored, "DKK", "2026-10-01")).toBeNull();
    expect(ecbRateFor(stored, "DKK", "2026-10-03")).toBeNull();
    expect(ecbRateFor(stored, "ISK", "2026-09-30")).toBeNull();
    expect(ecbRateFor([], "DKK", "2026-09-30")).toBeNull();
  });

  it("never reaches past the next publication day for an earlier day's rate", () => {
    // Wednesday 30 September is a publication day; a rate stored for Friday 2 October must not stand in for it.
    const onlyLater: EcbRate[] = [{ date: "2026-10-02", currency: "DKK", rate: "7.4736" }];
    expect(ecbRateFor(onlyLater, "DKK", "2026-09-30")).toBeNull();
  });

  it("uses a rate the ECB published on a day the calendar says is closed, when it is the first one on or after the day", () => {
    const unusual: EcbRate[] = [{ date: "2026-12-26", currency: "DKK", rate: "7.46" }, { date: "2026-12-28", currency: "DKK", rate: "7.47" }];
    expect(ecbRateFor(unusual, "DKK", "2026-12-25")).toEqual({ rate: "7.46", date: "2026-12-26" });
  });
});

describe("toEuroMinor", () => {
  it("converts the worked example of the spec: 1000.00 DKK is 133.77 EUR and 250.00 DKK is 33.44 EUR at 7.4755", () => {
    expect(toEuroMinor(100000, "7.4755")).toBe(13377);
    expect(toEuroMinor(25000, "7.4755")).toBe(3344);
    expect(toEuroMinor(12500, "7.4755")).toBe(1672);
  });

  it("leaves euro at rate 1 alone", () => {
    expect(toEuroMinor(10000, "1")).toBe(10000);
    expect(toEuroMinor(1, "1.000000")).toBe(1);
    expect(toEuroMinor(0, "7.4755")).toBe(0);
  });

  it("rounds half up on the absolute value, so a credit is exactly the negative of its invoice", () => {
    expect(toEuroMinor(5, "2")).toBe(3); // 2.5 -> 3
    expect(toEuroMinor(3, "2")).toBe(2); // 1.5 -> 2
    expect(toEuroMinor(1, "2")).toBe(1); // 0.5 -> 1
    expect(toEuroMinor(-5, "2")).toBe(-3);
    expect(toEuroMinor(-1, "2")).toBe(-1);
    expect(toEuroMinor(-1, "3")).toBe(0);
    expect(Object.is(toEuroMinor(-1, "3"), -0)).toBe(false);
    expect(toEuroMinor(4, "3")).toBe(1);
    expect(toEuroMinor(2, "3")).toBe(1); // 0.666 -> 1
    expect(toEuroMinor(1, "3")).toBe(0); // 0.333 -> 0
  });

  it("is sign symmetric over many amounts and rates", () => {
    for (const rate of ["7.4755", "10.9015", "11.331", "0.85463", "1", "176.99", "369.18"]) {
      for (let x = 0; x < 3000; x += 37) expect(toEuroMinor(-x, rate)).toBe(-toEuroMinor(x, rate) || 0);
    }
  });

  it("matches exact decimal arithmetic on a spread of values (no floating point drift)", () => {
    for (const [amount, rate] of [[123456789, "10.9015"], [99999999, "7.4755"], [1, "0.85463"], [987654321, "11.331"]] as const) {
      const scaled = rateScaled(rate);
      const exactTwice = (BigInt(2) * BigInt(amount) * BigInt(1_000_000) + scaled) / (BigInt(2) * scaled);
      expect(toEuroMinor(amount, rate)).toBe(Number(exactTwice));
    }
  });

  it("refuses a bad amount or a bad rate", () => {
    expect(() => toEuroMinor(1.5, "7.4755")).toThrow(RangeError);
    expect(() => toEuroMinor(Number.MAX_SAFE_INTEGER + 2, "7.4755")).toThrow(RangeError);
    expect(() => toEuroMinor(100, "0")).toThrow(RangeError);
    expect(() => toEuroMinor(100, "-1")).toThrow(RangeError);
    expect(() => toEuroMinor(100, "1e3")).toThrow(RangeError);
    expect(() => toEuroMinor(100, "7.1234567")).toThrow(RangeError);
    expect(() => toEuroMinor(100, "")).toThrow(RangeError);
  });
});

import { describe, expect, it } from "vitest";

import { parseEcbRates } from "./ecb";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>
    <Cube time='2026-09-29'>
      <Cube currency='USD' rate='1.1650'/>
      <Cube currency='SEK' rate='11.0250'/>
      <Cube currency='HUF' rate='395.10'/>
      <Cube currency='BAD' rate='0'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

describe("parseEcbRates", () => {
  it("reads the date and each currency's rate per euro", () => {
    const { date, rates } = parseEcbRates(XML);
    expect(date).toBe("2026-09-29");
    expect(rates.get("SEK")).toBe(11.025);
    expect(rates.get("HUF")).toBe(395.1);
  });

  it("skips rates that are not positive, and reads nothing from other text", () => {
    expect(parseEcbRates(XML).rates.has("BAD")).toBe(false);
    expect(parseEcbRates("<html>").rates.size).toBe(0);
  });
});

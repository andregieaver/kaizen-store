import { describe, expect, it } from "vitest";

import { companyRequired, organisationNumber, productShownTo, productSoldTo, storeBuyer, withVat, withoutVat } from "./b2b";

describe("prices without VAT", () => {
  it("keeps what an owner enters without VAT, whatever the rate", () => {
    for (const rate of [0.25, 0.255, 0.24, 0.21, 0.19, 0.12, 0.06, 0.2, 0.17, 0]) {
      for (let net = 0; net < 20_000; net += 7) {
        expect(withoutVat(withVat(net, rate), rate)).toBe(net);
      }
    }
    expect(withVat(10000, 0.25)).toBe(12500);
    expect(withoutVat(24900, 0.25)).toBe(19920);
  });
});

describe("buyers and products", () => {
  it("shows each buyer their products, and sells business-only ones to businesses", () => {
    expect(storeBuyer("consumers", "business")).toBe("private");
    expect(storeBuyer("businesses", null)).toBe("business");
    expect(storeBuyer("both", null)).toBe("private");
    expect(storeBuyer("both", "business")).toBe("business");

    expect(productShownTo("businesses", "private", "both")).toBe(false);
    expect(productShownTo("consumers", "business", "both")).toBe(false);
    expect(productShownTo("businesses", "business", "both")).toBe(true);
    expect(productShownTo("businesses", "private", "consumers")).toBe(true);
    expect(productShownTo("all", "business", "both")).toBe(true);

    expect(productSoldTo("businesses", "private", "both")).toBe(false);
    expect(productSoldTo("consumers", "business", "both")).toBe(true);
    expect(productSoldTo("businesses", "business", "both")).toBe(true);

    expect(companyRequired("businesses", [])).toBe(true);
    expect(companyRequired("both", ["all", "consumers"])).toBe(false);
    expect(companyRequired("both", ["all", "businesses"])).toBe(true);
    expect(companyRequired("consumers", ["businesses"])).toBe(false);
  });
});

describe("organisation numbers", () => {
  it("checks those of countries whose check is known, as they are written", () => {
    expect(organisationNumber("NO", "923 609 016")).toBe("923609016");
    expect(organisationNumber("NO", "NO923609016MVA")).toBe("923609016");
    expect(organisationNumber("NO", "923609017")).toBeNull();
    expect(organisationNumber("NO", "92360901")).toBeNull();
    expect(organisationNumber("SE", "556016-0680")).toBe("556016-0680");
    expect(organisationNumber("SE", "165560160680")).toBe("556016-0680");
    expect(organisationNumber("SE", "556016-0681")).toBeNull();
    expect(organisationNumber("DK", "DK 22756214")).toBe("22756214");
    expect(organisationNumber("DK", "61056416")).toBe("61056416");
    expect(organisationNumber("DK", "22756215")).toBeNull();
    expect(organisationNumber("FI", "0112038-9")).toBe("0112038-9");
    expect(organisationNumber("FI", "0112038-8")).toBeNull();
    expect(organisationNumber("NO", "abc")).toBeNull();
  });

  it("takes any plain registration number elsewhere", () => {
    expect(organisationNumber("DE", " hrb 12345 ")).toBe("HRB 12345");
    expect(organisationNumber("NL", "12345678")).toBe("12345678");
    expect(organisationNumber("DE", "x")).toBeNull();
    expect(organisationNumber(null, "<script>")).toBeNull();
  });
});

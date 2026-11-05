import { describe, expect, it } from "vitest";

import { canCheck, carrierComplete, carrierInfo, CARRIER_IDS, CARRIERS, EUROPE, FOLLOWED_CARRIERS, isCarrierId, parseCarrierForm, secretHint, senderAddress } from "./shipping-carriers";

const bring = carrierInfo("bring")!;
const none = { hasSecret: () => false };

describe("the carriers", () => {
  it("are the ten the store can connect", () => {
    expect(CARRIER_IDS).toEqual(["bring", "postnord", "porterbuddy", "helthjem", "instabox", "dhl", "ups", "dhl_paket", "nshift", "sendcloud"]);
    expect(CARRIERS.map((c) => c.id)).toEqual(CARRIER_IDS);
    expect(isCarrierId("dhl")).toBe(true);
    expect(isCarrierId("dpd")).toBe(false);
  });

  it("follow every carrier's parcels but Instabox's, which its own page follows, and Sendcloud's, which books nothing yet", () => {
    expect(FOLLOWED_CARRIERS).toEqual(["bring", "postnord", "porterbuddy", "helthjem", "dhl", "ups", "dhl_paket", "nshift"]);
  });

  it("say what each does now, each feature named in the admin, and books returns only where it says (D459)", () => {
    for (const carrier of CARRIERS) {
      for (const f of carrier.available) expect(carrier.features, `${carrier.id} ${f}`).toContain(f);
      expect(Boolean(carrier.returnCountries?.length), carrier.id).toBe(carrier.available.includes("return_labels"));
      if (carrier.collectionCountries) expect(carrier.available).toContain("collection");
      if (carrier.available.includes("collection")) expect(carrier.fields.some((f) => f.key === "collectionHours" && !f.required), carrier.id).toBe(true);
    }
    expect(carrierInfo("postnord")!.available).toEqual(expect.arrayContaining(["labels", "return_labels", "collection"]));
    expect(carrierInfo("postnord")!.collectionCountries).toEqual(["SE", "DK", "FI"]);
    // nShift's return labels wait for a test account (the return shipment's parties are not confirmed).
    expect(carrierInfo("nshift")!.available).not.toContain("return_labels");
  });

  it("ask the carriers that ship from anywhere in Europe where the parcels leave from", () => {
    for (const id of ["dhl", "ups"]) {
      const info = carrierInfo(id)!;
      expect(info.countries).toEqual(EUROPE);
      expect(info.fields.find((f) => f.key === "senderCountry")).toMatchObject({ required: true, format: "country" });
      expect(info.fields.find((f) => f.key === "accountNumber")).toMatchObject({ required: true, secret: false });
    }
  });

  it("each need a secret that is required (an API key, Helthjem's client secret or Sendcloud's secret key), and say what they will do", () => {
    for (const carrier of CARRIERS) {
      expect(carrier.fields.some((f) => (f.key === "apiKey" || f.key === "clientSecret" || f.key === "secretKey") && f.secret && f.required)).toBe(true);
      expect(carrier.features).toContain("rates");
      expect(carrier.countries.length).toBeGreaterThan(0);
      expect(carrier.steps.length).toBeGreaterThan(1);
    }
    expect(carrierInfo("porterbuddy")!.features).toContain("same_day");
  });
});

describe("Sendcloud's first step (D454)", () => {
  const sendcloud = carrierInfo("sendcloud")!;

  it("can be checked before anything else works, as can every carrier with a working feature", () => {
    expect(sendcloud.available).toEqual([]);
    expect(canCheck(sendcloud)).toBe(true);
    expect(canCheck(carrierInfo("bring")!)).toBe(true);
    expect(canCheck({ available: [] })).toBe(false);
  });

  it("is complete with its two keys; the sender address is chosen after, from Sendcloud's own list", () => {
    expect(carrierComplete(sendcloud, { publicKey: "pub" }, ["secretKey"])).toBe(true);
    const form = (senderAddressId: string) => ({ environment: "live", countries: ["de"], fields: { publicKey: "pub", secretKey: "sec", senderAddressId } });
    expect(parseCarrierForm(sendcloud, form("12"), none)).toMatchObject({ ok: true, details: { publicKey: "pub", senderAddressId: "12" }, secrets: { secretKey: "sec" } });
    expect(parseCarrierForm(sendcloud, form(""), none)).toMatchObject({ ok: true, details: { publicKey: "pub" } });
    expect(parseCarrierForm(sendcloud, form("Berlin"), none)).toEqual({ ok: false, problems: ["Choose the sender address from the list."] });
  });
});

describe("parseCarrierForm", () => {
  const sender = { senderName: "Shop AS", senderStreet: "Lagerveien 2", senderPostalCode: "0150", senderCity: "Oslo" };
  const good = { environment: "test", countries: ["no", "SE", "no", "x1"], fields: { customerNumber: " 123 ", apiUid: "me@shop.no", apiKey: "secret-key-1234", ...sender } };

  it("splits details from secrets, tidies the countries and keeps the environment", () => {
    const parsed = parseCarrierForm(bring, good, none);
    expect(parsed).toEqual({
      ok: true,
      environment: "test",
      countries: ["NO", "SE"],
      details: { customerNumber: "123", apiUid: "me@shop.no", ...sender },
      secrets: { apiKey: "secret-key-1234" },
    });
  });

  it("keeps a saved secret when the field is left empty, and asks for one that is not saved", () => {
    const left = { ...good, fields: { ...good.fields, apiKey: "" } };
    expect(parseCarrierForm(bring, left, { hasSecret: (k) => k === "apiKey" }).ok).toBe(true);
    const parsed = parseCarrierForm(bring, left, none);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.problems).toEqual(["Enter the mybring api key."]);
  });

  it("asks for every missing detail and a known environment", () => {
    const parsed = parseCarrierForm(bring, { environment: "staging", countries: [], fields: {} }, { hasSecret: () => true });
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.problems).toContain("Choose test or live.");
    expect(!parsed.ok && parsed.problems).toContain("Enter the customer number.");
  });

  it("ignores fields the carrier does not have and refuses very long ones", () => {
    const parsed = parseCarrierForm(bring, { ...good, fields: { ...good.fields, other: "x", apiUid: "u".repeat(201) } }, none);
    expect(parsed.ok).toBe(false);
    const fine = parseCarrierForm(bring, { ...good, fields: { ...good.fields, other: "x" } }, none);
    expect(fine.ok && Object.keys(fine.details)).toEqual(["customerNumber", "apiUid", "senderName", "senderStreet", "senderPostalCode", "senderCity"]);
  });
});

describe("a sender's country", () => {
  const ups = carrierInfo("ups")!;
  const fields = { clientId: "c", clientSecret: "s", accountNumber: "A1B2C3", senderName: "Shop", senderStreet: "Hauptstr. 1", senderPostalCode: "10115", senderCity: "Berlin", senderPhone: "+4930123" };

  it("is written in capitals, and refused when it is not two letters", () => {
    const parsed = parseCarrierForm(ups, { environment: "test", countries: [], fields: { ...fields, senderCountry: "de" } }, none);
    expect(parsed.ok && parsed.details.senderCountry).toBe("DE");
    const wrong = parseCarrierForm(ups, { environment: "test", countries: [], fields: { ...fields, senderCountry: "Germany" } }, none);
    expect(!wrong.ok && wrong.problems).toEqual(["Sender country: enter the country's two-letter code, like NO or SE."]);
  });

  it("is where the parcels leave from, Norway for a carrier that does not ask", () => {
    expect(senderAddress({ ...fields, senderCountry: "DE", senderEmail: "a@b.de" })).toEqual({ name: "Shop", street: "Hauptstr. 1", postalCode: "10115", city: "Berlin", country: "DE", phone: "+4930123", email: "a@b.de" });
    expect(senderAddress({ senderName: "Shop" }).country).toBe("NO");
  });
});

describe("carrierComplete and secretHint", () => {
  it("is complete when every required detail and secret is saved", () => {
    expect(carrierComplete(bring, { customerNumber: "1", apiUid: "u", senderName: "S", senderStreet: "x", senderPostalCode: "0150", senderCity: "Oslo" }, ["apiKey"])).toBe(true);
    expect(carrierComplete(bring, { customerNumber: "1" }, ["apiKey"])).toBe(false);
    expect(carrierComplete(bring, { customerNumber: "1", apiUid: "u" }, [])).toBe(false);
    // Porterbuddy needs its key and where the courier collects the parcels; the hours and days are optional.
    const porterbuddy = carrierInfo("porterbuddy")!;
    const pickup = { senderName: "S", senderStreet: "Keysers gate 3", senderPostalCode: "0165", senderCity: "Oslo", senderEmail: "a@b.no", senderPhone: "12345678" };
    expect(carrierComplete(porterbuddy, pickup, ["apiKey"])).toBe(true);
    expect(carrierComplete(porterbuddy, {}, ["apiKey"])).toBe(false);
    expect(carrierComplete(porterbuddy, pickup, [])).toBe(false);
  });

  it("shows only the last four characters of a long secret", () => {
    expect(secretHint("abcdefghijkl")).toBe("…ijkl");
    expect(secretHint("short")).toBe("…");
  });
});

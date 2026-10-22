import { describe, expect, it } from "vitest";

import { CAPTURE_SETTING_WORDS, CAPTURE_SETTINGS } from "../capture";
import { knownText } from "../known-words";
import { METHOD_STATE_WORDS, PAYMENT_METHODS, stateReason } from "../payment-methods";
import { OSS_SCHEME_LABELS, TAX_WARNINGS, readiness, type TaxProfile } from "../tax-profile";
import { paymentsEn } from "./payments.en";
import { paymentsNb } from "./payments.nb";
import { taxEn } from "./tax.en";
import { taxNb } from "./tax.nb";

/** Every string of a catalogue, by its path. */
function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  return [];
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const profile: TaxProfile = {
  vatRegistered: false,
  vatNumber: null,
  vatNumberCheckId: null,
  vatNumberCheckedAt: null,
  vatNumberValid: null,
  dispatchCountry: null,
  ossScheme: "none",
  ossMemberState: null,
  ossNumber: null,
  ossRegisteredOn: null,
  iossNumber: null,
  iossIntermediary: null,
  iossMarkets: [],
  iossRegisteredOn: null,
} as TaxProfile;

describe("the tax and payments words (D312 A8)", () => {
  it("are the libraries' own English, so the AI manager and the tests read the same", () => {
    expect(OSS_SCHEME_LABELS).toEqual(taxEn.schemes);
    expect(TAX_WARNINGS).toEqual(taxEn.warnings.items);
    expect(METHOD_STATE_WORDS).toEqual(paymentsEn.methods.states);
    for (const setting of CAPTURE_SETTINGS) expect(paymentsEn.orders.capture[setting]).toEqual(CAPTURE_SETTING_WORDS[setting]);
    for (const method of PAYMENT_METHODS) expect(paymentsEn.methods.kinds[method.type]).toEqual({ label: method.label, where: method.where });
    expect(stateReason("unsupported_country")).toBe("Stripe does not offer it in your country");
    expect(stateReason("something_new")).toBe("something_new");
  });

  it("say what is on and off as before in English, and in Norwegian when given", () => {
    const en = readiness(profile, "NO");
    expect(en[0].text).toBe("VAT registration: off. Needs registration for VAT to be switched on.");
    expect(en[1].text).toBe("Reverse charge: off. Needs a store established in an EU member state (a store outside the EU never uses reverse charge).");
    const nb = readiness(profile, "NO", taxNb.readiness);
    expect(nb[0].text).toBe("Registrering for merverdiavgift: av. Trenger at registreringen i Merverdiavgiftsregisteret slås på.");
    expect(nb.map((line) => line.on)).toEqual(en.map((line) => line.on));
  });

  it("keep every placeholder in Norwegian", () => {
    for (const [en, nb] of [
      [taxEn, taxNb],
      [paymentsEn, paymentsNb],
    ] as const) {
      const norwegian = new Map(strings(nb));
      for (const [path, english] of strings(en)) {
        expect(norwegian.has(path), path).toBe(true);
        expect(placeholders(norwegian.get(path) ?? ""), path).toEqual(placeholders(english));
      }
    }
  });

  it("say the server's English refusals in the account's language, and leave unknown ones as written", () => {
    expect(knownText("The VAT number must be one of the store's own country (it starts with NO).", taxEn.problems, taxNb.problems)).toBe(
      "Mva-nummeret må være fra butikkens eget land (det begynner med NO).",
    );
    expect(knownText("The VAT number must be one of the store's own country.", taxEn.problems, taxNb.problems)).toBe(taxNb.problems.dbPrefix);
    expect(knownText("Payments in live mode are not available yet.", paymentsEn.problems, paymentsNb.problems)).toBe("Betalinger i live-modus er ikke tilgjengelige ennå.");
    expect(knownText("Something Stripe said.", paymentsEn.problems, paymentsNb.problems)).toBe("Something Stripe said.");
    expect(knownText("Unknown mode.", paymentsEn.problems, paymentsEn.problems)).toBe("Unknown mode.");
  });
});

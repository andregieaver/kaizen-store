import { describe, expect, it } from "vitest";

import { VAT_REASONS } from "./vat-treatment";
import {
  VAT_PROBLEM_OUTCOMES,
  countryName,
  vatNumberMessage,
  vatProblemText,
  vatProblemTexts,
  vatText,
  type VatNumberFacts,
  type VatText,
} from "./vat-text";

const LANGS = ["nb", "sv", "da", "en"] as const;

/** Every string of the text, with where it sits (functions are called with sample arguments). */
function strings(text: VatText): [string, string][] {
  const out: [string, string][] = [];
  const walk = (value: unknown, path: string) => {
    if (typeof value === "string") out.push([path, value]);
    else if (typeof value === "function") out.push([path, (value as (...a: unknown[]) => string)(0.25, "DE", "SE", "IM2760000742")]);
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
  };
  walk(text, "");
  return out;
}

describe("the VAT wording of the shopper's pages (D157)", () => {
  it("is written by hand in nb, sv, da and en: every text there, none empty, none left as a placeholder", () => {
    for (const lang of LANGS) {
      const all = strings(vatText(lang));
      expect(all.length).toBeGreaterThan(25);
      for (const [path, value] of all) {
        expect(value.trim().length, `${lang}${path}`).toBeGreaterThan(2);
        expect(value, `${lang}${path}`).not.toMatch(/[{}]|undefined|NaN/);
      }
    }
  });

  it("has the same keys in every language", () => {
    const keys = (lang: string) => strings(vatText(lang)).map(([path]) => path);
    for (const lang of LANGS) expect(keys(lang)).toEqual(keys("en"));
  });

  it("shows English for any other language: legal wording is never machine-translated", () => {
    expect(vatText("fr")).toEqual(vatText("en"));
    expect(vatText("fi").reverseCharge).toBe(vatText("en").reverseCharge);
  });

  it("says reverse charge in each language's own legal term", () => {
    expect(vatText("nb").reverseCharge).toContain("Omvendt avgiftsplikt");
    expect(vatText("sv").reverseCharge).toContain("Omvänd skattskyldighet");
    expect(vatText("da").reverseCharge).toContain("Omvendt betalingspligt");
    expect(vatText("en").reverseCharge).toContain("Reverse charge");
  });

  it("is the words of the emails for the statements an order carries", () => {
    expect(vatText("nb").ioss("IM2760000742")).toContain("IM2760000742");
    expect(vatText("en").sellerNumber).toBe("Seller's VAT number");
  });

  it("words a rate as a percentage", () => {
    expect(vatText("en").vatAtRate(0.15)).toBe("of which VAT 15 %");
    expect(vatText("nb").vatAtRate(0.255)).toBe("herav mva. 25.5 %");
  });
});

const facts = (reason: string, over: Partial<VatNumberFacts> = {}): VatNumberFacts => ({
  reason,
  buyerVatNumber: "DE123456789",
  numberCountry: "Germany",
  deliveryCountry: "Sweden",
  ...over,
});

describe("what is said of the number the shopper typed", () => {
  const en = vatText("en");

  it("never says the VAT is not charged unless reverse charge applies", () => {
    for (const lang of LANGS) {
      const text = vatText(lang);
      for (const reason of VAT_REASONS) {
        const message = vatNumberMessage(facts(reason), text);
        if (reason === "reverse_charge") expect(message?.tone).toBe("ok");
        else if (message && reason !== "nothing_taxable") {
          expect(message.tone, `${lang} ${reason}`).toBe("warn");
          // Each says VAT is charged, in its language.
          expect(message.text, `${lang} ${reason}`).toMatch(/charged|beregnes|debiteras|opkræves/);
        }
      }
    }
  });

  it("has a sentence for each reason that has to do with the number, and none for the rest", () => {
    const withText = VAT_REASONS.filter((reason) => vatNumberMessage(facts(reason), en) !== null);
    expect(withText).toEqual([
      "number_invalid",
      "number_unavailable",
      "number_stale",
      "number_not_eu",
      "number_other_country",
      "own_number",
      "nothing_taxable",
      "reverse_charge",
    ].sort((a, b) => VAT_REASONS.indexOf(a as never) - VAT_REASONS.indexOf(b as never)));
  });

  it("says nothing when no number is on the cart", () => {
    expect(vatNumberMessage(facts("reverse_charge", { buyerVatNumber: null }), en)).toBeNull();
  });

  it("names both countries when the number is for another country than the goods go to", () => {
    expect(vatNumberMessage(facts("number_other_country"), en)?.text).toBe("The number is for Germany, but the goods go to Sweden. VAT is charged.");
  });

  it("tells plainly that VIES could not answer, and that VAT is charged: a number that could not be checked is never exempt", () => {
    for (const lang of LANGS) {
      const unavailable = vatNumberMessage(facts("number_unavailable"), vatText(lang));
      expect(unavailable?.tone).toBe("warn");
      expect(unavailable?.text).not.toBe(vatNumberMessage(facts("reverse_charge"), vatText(lang))?.text);
    }
    expect(vatNumberMessage(facts("number_unavailable"), en)?.text).toBe("The VAT number could not be checked right now. VAT is charged. Try again in a moment.");
    expect(vatNumberMessage(facts("number_stale"), en)?.text).toBe(vatNumberMessage(facts("number_unavailable"), en)?.text);
  });
});

describe("what is said of a problem with what was typed", () => {
  it("has a text for every problem the action can name and none for its other outcomes", () => {
    const en = vatText("en");
    for (const outcome of VAT_PROBLEM_OUTCOMES) expect(vatProblemText(outcome, en), outcome).toBeTruthy();
    for (const outcome of ["idle", "cleared", "valid", "invalid", "unavailable", "not_eu", "own_number"]) expect(vatProblemText(outcome, en), outcome).toBeNull();
    expect(Object.keys(vatProblemTexts(en)).sort()).toEqual([...VAT_PROBLEM_OUTCOMES].sort());
  });
});

describe("country names", () => {
  it("are the shopper's own language's, or the code when it is not known", () => {
    expect(countryName("DE", "nb-NO")).toBe("Tyskland");
    expect(countryName("DE", "en-IE")).toBe("Germany");
    expect(countryName("", "en")).toBe("");
  });
});

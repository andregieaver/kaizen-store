import { describe, expect, it } from "vitest";

import { localizationOf } from "./localization";
import { movedMarketSlug } from "./market-move";
import { offeredMarkets, toMarket } from "./markets";

const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const se = toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" });
const dk = toMarket({ code: "DK", currency: "DKK", defaultLocale: "da-DK" });
const rates = [
  { currency: "NOK", rate: 11.6, roundTo: 1 },
  { currency: "SEK", rate: 11, roundTo: 1 },
  { currency: "EUR", rate: 1, roundTo: 1 },
];

/** A store with Norway, Sweden and (taken off its list) Denmark, English and euro, and these features on. */
function store(on: { countries: boolean; languages: boolean; currencies: boolean }) {
  const kept = [no, se];
  const markets = offeredMarkets(kept, on.countries);
  return { markets, allMarkets: [no, se, dk], localization: localizationOf(["nb-NO", "en-GB"], rates, markets, { kept, ...on }) };
}

describe("where an address the store no longer offers goes (D178)", () => {
  const all = store({ countries: true, languages: true, currencies: true });

  it("moves nowhere when the address is offered, or names no country the store had", () => {
    for (const slug of ["no", "se", "no-en", "no-eur", "se-en-eur"]) expect(movedMarketSlug(all, slug)).toBeNull();
    expect(movedMarketSlug(all, "fi")).toBeNull();
    expect(movedMarketSlug(all, "om-oss")).toBeNull();
  });

  it("takes another country to the store's own, keeping the language and currency it offers there", () => {
    const one = store({ countries: false, languages: true, currencies: true });
    expect(movedMarketSlug(one, "se")).toBe("no");
    expect(movedMarketSlug(one, "se-en")).toBe("no-en");
    expect(movedMarketSlug(one, "se-en-eur")).toBe("no-en-eur");
    expect(movedMarketSlug(one, "se-sek")).toBe("no-sek");
    // A country taken off the list (inactive) goes to the store's own too, whatever the switch.
    expect(movedMarketSlug(all, "dk")).toBe("no");
    expect(movedMarketSlug(all, "dk-en")).toBe("no-en");
  });

  it("drops a language with Several languages off and a currency with Several currencies off", () => {
    const noLanguages = store({ countries: true, languages: false, currencies: true });
    expect(movedMarketSlug(noLanguages, "no-en")).toBe("no");
    expect(movedMarketSlug(noLanguages, "se-nb")).toBe("se");
    expect(movedMarketSlug(noLanguages, "no-en-eur")).toBe("no-eur");
    const noCurrencies = store({ countries: true, languages: true, currencies: false });
    expect(movedMarketSlug(noCurrencies, "no-eur")).toBe("no");
    expect(movedMarketSlug(noCurrencies, "no-en-eur")).toBe("no-en");
    expect(movedMarketSlug(noCurrencies, "no-sek")).toBe("no");
    const none = store({ countries: false, languages: false, currencies: false });
    expect(movedMarketSlug(none, "se-en-eur")).toBe("no");
  });

  it("always gives an address that is offered, so a move never loops", () => {
    const variants = [true, false];
    for (const countries of variants) for (const languages of variants) for (const currencies of variants) {
      const s = store({ countries, languages, currencies });
      for (const slug of ["no", "se", "dk", "no-en", "se-en", "no-eur", "se-eur", "no-en-eur", "dk-en-eur", "se-sek", "no-sv"]) {
        const to = movedMarketSlug(s, slug);
        if (to !== null) {
          expect(to).not.toBe(slug);
          expect(movedMarketSlug(s, to)).toBeNull();
        }
      }
    }
  });
});

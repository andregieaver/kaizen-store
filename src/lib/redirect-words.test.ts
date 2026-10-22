import { describe, expect, it } from "vitest";

import { redirectsEn } from "./admin-messages/redirects.en";
import { redirectsNb } from "./admin-messages/redirects.nb";
import { finding } from "./data-job";
import { redirectFindingText, redirectProblemText } from "./redirect-words";
import { experimentsEn } from "./admin-messages/experiments.en";
import { experimentsNb } from "./admin-messages/experiments.nb";
import { experimentProblemText, partLabelText, variantNameText } from "./experiment-words";
import { estimateRuntime, verdictOf } from "./experiment-results";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the redirect catalogue", () => {
  it("has the same placeholders in Norwegian as in English", () => {
    for (const [code, english] of Object.entries(redirectsEn.findings)) expect(placeholders(redirectsNb.findings[code as keyof typeof redirectsNb.findings])).toEqual(placeholders(english));
    for (const [key, english] of Object.entries(redirectsEn.problems)) expect(placeholders(redirectsNb.problems[key as keyof typeof redirectsNb.problems])).toEqual(placeholders(english));
  });

  it("says every check's English sentence in its own words, with the addresses carried over", () => {
    const live = finding("source.live", { address: "/collections/shoes" });
    expect(redirectFindingText(live)).toBe(live.text);
    expect(redirectFindingText(live, redirectsNb)).toBe('"/collections/shoes" er en publisert side, et produkt, en kategori, et stikkord eller en artikkel nå. Omdiriger bare fra en adresse som ikke finnes.');
    const loop = finding("target.loop", { address: "/a", addresses: ["/b", "/c", "/a"] });
    expect(redirectFindingText(loop, redirectsNb)).toBe('"/a" ville lukket en sløyfe via "/b", "/c" og "/a", så kunden ville aldri kommet fram.');
    const many = finding("target.chain", { addresses: ["/1", "/2", "/3", "/4", "/5", "/6", "/7"] });
    expect(redirectFindingText(many, redirectsNb)).toContain('"/4" og "/5" og 2 til)');
    expect(redirectFindingText(finding("limit.reached", { max: 100000 }), redirectsNb)).toContain("mer enn 100000 egne");
  });

  it("keeps the English a matching English template gives", () => {
    for (const code of Object.keys(redirectsEn.findings)) {
      const f = finding(code as never, { address: "/x", addresses: ["/y", "/z"], max: 5 });
      expect(redirectFindingText(f, redirectsEn)).toBe(f.text);
    }
  });

  it("says the service's refusals, and leaves an unknown one as written", () => {
    for (const text of Object.values(redirectsEn.problems)) expect(redirectProblemText(text, redirectsNb)).not.toBe(text);
    expect(redirectProblemText("Choose at most 200 redirects at a time.", redirectsNb)).toBe("Velg høyst 200 omdirigeringer om gangen.");
    expect(redirectProblemText("Something else.", redirectsNb)).toBe("Something else.");
  });
});

describe("the A/B test catalogue", () => {
  it("has the same placeholders in Norwegian as in English", () => {
    for (const [key, english] of Object.entries(experimentsEn.problems)) expect(placeholders(experimentsNb.problems[key as keyof typeof experimentsNb.problems])).toEqual(placeholders(english));
    for (const [key, english] of Object.entries(experimentsEn.verdict)) {
      const nb = experimentsNb.verdict[key as keyof typeof experimentsNb.verdict];
      if (typeof english === "string") expect(placeholders(nb as string)).toEqual(placeholders(english));
    }
  });

  it("says a part's label, a version's name and a refusal in Norwegian", () => {
    expect(partLabelText("Column 2 of row 3", experimentsNb)).toBe("Kolonne 2 i rad 3");
    expect(partLabelText("Heading “Welcome” in row 1", experimentsNb)).toBe("Heading «Welcome» i rad 1");
    expect(partLabelText("Row 4", experimentsNb)).toBe("Rad 4");
    expect(variantNameText("Version C", experimentsNb)).toBe("Versjon C");
    expect(variantNameText("My own", experimentsNb)).toBe("My own");
    expect(experimentProblemText("Version B changes more than Row 2. Put everything else back as it was, or test the whole page instead.", experimentsNb)).toBe(
      "Versjon B endrer mer enn Rad 2. Sett alt annet tilbake slik det var, eller test hele siden i stedet.",
    );
    expect(experimentProblemText("That form is not in the part you are testing.", experimentsNb)).toBe("Det skjemaet er ikke i delen du tester.");
    expect(experimentProblemText("A test has at most 4 versions, the original included.", experimentsNb)).toBe("En test har høyst 4 versjoner, originalen medregnet.");
  });

  it("writes the verdict and the estimate in Norwegian when given the words, and in English unchanged when not", () => {
    const input = {
      goal: "orders" as const,
      figures: [
        { key: "a", name: "Original", visitors: 100, conversions: 2, money: null },
        { key: "b", name: "Version B", visitors: 100, conversions: 3, money: null },
      ],
      splitP: 0.5,
      days: 3,
      minVisitors: 100,
      minDays: 14,
      currency: "NOK",
      locale: "nb-NO",
    };
    expect(verdictOf(input).headline).toBe("Too early to say.");
    const nb = verdictOf({ ...input, words: experimentsNb, numberLocale: "nb-NO" });
    expect(nb.headline).toBe("For tidlig å si.");
    expect(nb.detail).toContain("Vent på");
    expect(nb.detail).toContain("11 dager til");
    const estimate = estimateRuntime({ baseline: 0.03, relativeChange: 0.2, versions: 2, eligiblePerDay: 200, trafficShare: 1, words: experimentsNb, numberLocale: "nb-NO" });
    expect(estimate?.sentence).toMatch(/^For å se en endring på 20 %/);
  });
});

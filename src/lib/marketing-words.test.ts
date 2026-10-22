import { describe, expect, it } from "vitest";

import { marketingEn } from "./admin-messages/marketing.en";
import { marketingNb } from "./admin-messages/marketing.nb";
import { automationDays, marketingProblem } from "./marketing-words";
import { describeRules } from "./segments";

const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the marketing screens' words (D312 A6)", () => {
  it("say the server's English answers in Norwegian, with their parts carried over", () => {
    expect(marketingProblem("Another segment already has that name.", marketingNb.problems)).toBe("Et annet segment har allerede det navnet.");
    expect(marketingProblem("The days must be a whole number from 1 to 90.", marketingNb.problems)).toBe("Dagene må være et helt tall fra 1 til 90.");
    expect(marketingProblem("It is on, so it needs words it can send: Write a subject in the main language.", marketingNb.problems)).toBe(
      "Den er på, så den trenger ord den kan sende: Skriv et emne på hovedspråket.",
    );
    expect(marketingProblem("Something nobody listed.", marketingNb.problems)).toBe("Something nobody listed.");
    expect(marketingProblem("Another segment already has that name.", marketingEn.problems)).toBe("Another segment already has that name.");
  });

  it("keep every placeholder in Norwegian", () => {
    for (const [key, english] of Object.entries(marketingEn.problems)) {
      expect(names(marketingNb.problems[key as keyof typeof marketingNb.problems]), key).toEqual(names(english));
    }
  });

  it("write a segment's rules and an automation's days in the language", () => {
    const ctx = { money: (minor: number) => `${minor / 100} kr`, words: marketingNb.describe };
    expect(describeRules({ match: "all", conditions: [{ kind: "orders", op: "atLeast", value: 2 }, { kind: "lastOrder", op: "before", days: 1 }] }, ctx)).toBe(
      "Har bestilt minst 2 ganger · og Siste bestilling for mer enn 1 dag siden",
    );
    expect(describeRules({ match: "all", conditions: [] }, ctx)).toBe("Alle");
    expect(automationDays("welcome", 0)).toBe("Sent as soon as they join.");
    expect(automationDays("after_purchase", 7, marketingNb.automations)).toBe("Sendes 7 dager etter at bestillingen er levert.");
  });
});

import { describe, expect, it } from "vitest";

import { withdrawalInformation, type WithdrawalEmailFacts } from "./withdrawal-email";

const facts = (over: Partial<WithdrawalEmailFacts> = {}): WithdrawalEmailFacts => ({
  locale: "en-GB",
  seller: { name: "Mug Makers AS", address: "Storgata 1, 0155 Oslo", email: "post@example.com" },
  goods: true,
  whoPays: "shopper",
  services: false,
  consents: [],
  ...over,
});
const words = (blocks: ReturnType<typeof withdrawalInformation>) => blocks.map((b) => ("text" in b ? b.text : "")).join("\n");

describe("the withdrawal information in the confirmation email (D407 step 4)", () => {
  it("carries the right, how to use it, what follows and the model form, with the seller's own details", () => {
    const text = words(withdrawalInformation(facts()));
    expect(text).toContain("within 14 days without giving any reason");
    expect(text).toContain("inform Mug Makers AS, Storgata 1, 0155 Oslo, post@example.com, of your decision");
    expect(text).toContain("You pay the direct cost of returning the goods.");
    expect(text).toContain("To Mug Makers AS, Storgata 1, 0155 Oslo, post@example.com:");
    expect(text).toContain("I/We (*) hereby give notice");
  });

  it("leaves out a detail that is not known, never a placeholder", () => {
    const text = words(withdrawalInformation(facts({ seller: { name: "Mug Makers AS", address: null, email: "post@example.com" } })));
    expect(text).toContain("To Mug Makers AS, post@example.com:");
    expect(text).not.toMatch(/\{|\[\[/);
  });

  it("speaks of a service's period and proportionate payment, and of goods only for goods", () => {
    const text = words(withdrawalInformation(facts({ goods: false, services: true, whoPays: null })));
    expect(text).toContain("14 days after the day the contract is made");
    expect(text).toContain("in proportion to what has been provided");
    expect(text).not.toContain("returning the goods");
  });

  it("confirms a consent in its own words, also where nothing keeps the right", () => {
    const blocks = withdrawalInformation(facts({ goods: false, consents: ["I agree that the download becomes available straight after payment."] }));
    expect(blocks).toEqual([{ type: "paragraph", text: "At checkout you agreed to this: «I agree that the download becomes available straight after payment.»" }]);
    expect(withdrawalInformation(facts({ goods: false }))).toEqual([]);
  });

  it("is in the order's language", () => {
    expect(words(withdrawalInformation(facts({ locale: "nb-NO" })))).toContain("Angrerett");
    expect(words(withdrawalInformation(facts({ locale: "sv-SE" })))).toMatch(/ånger/i);
    expect(words(withdrawalInformation(facts({ locale: "da-DK" })))).toMatch(/fortryd/i);
  });
});

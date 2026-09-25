import { describe, expect, it } from "vitest";

import { buildReminderEmail, defaultSteps, describeDelay } from "./cart-reminders";
import { renderEmail } from "./email-layout";

describe("cart reminder emails (D33)", () => {
  const lines = [
    { variantId: "v1", sellingPlanId: null, title: "Kopp", quantity: 2, unitPriceMinor: 24900 },
    { variantId: "v2", sellingPlanId: null, title: "Handlenett", quantity: 1, unitPriceMinor: 19900 },
  ];

  it("fill in the store and code, list the cart with its total, and end with the way out", () => {
    const content = buildReminderEmail({
      text: { subject: "Glemte du noe hos {store}?", heading: "Hei", body: "Første.\n\nBruk {code}.", button: "Fullfør" },
      locale: "nb-NO",
      currency: "NOK",
      storeName: "Kopp & Kanne",
      footer: ["Kopp & Kanne AS"],
      lines,
      code: "TILBAKE10",
      restoreUrl: "https://kaizenstore.cloud/s/kopp/no/cart/restore/abc?code=TILBAKE10",
      unsubscribeUrl: "https://kaizenstore.cloud/s/kopp/no/unsubscribe/abc",
    });
    expect(content.subject).toBe("Glemte du noe hos Kopp & Kanne?");
    expect(content.blocks.filter((b) => b.type === "paragraph").map((b) => (b as { text: string }).text)).toEqual([
      "Første.",
      "Bruk TILBAKE10.",
      "Rabattkoden TILBAKE10 legges i handlekurven når du går tilbake til den.",
    ]);
    const { html, text } = renderEmail(content);
    expect(text).toContain("2 × Kopp");
    expect(text).toContain("Sum");
    expect(text.replace(/\s/g, " ")).toContain("697,00");
    expect(html).toContain('href="https://kaizenstore.cloud/s/kopp/no/unsubscribe/abc"');
    expect(text).toContain("Meld deg av: https://kaizenstore.cloud/s/kopp/no/unsubscribe/abc");
  });

  it("start stores with three reminders in their languages", () => {
    const steps = defaultSteps(["da-DK", "de-DE"]);
    expect(steps.map((s) => describeDelay(s.delayMinutes))).toEqual(["1 hour", "1 day", "3 days"]);
    expect(steps[0].content["da-DK"].button).toBe("Gennemfør købet");
    // A language without its own texts starts in English.
    expect(steps[0].content["de-DE"].button).toBe("Finish your purchase");
    expect(describeDelay(90)).toBe("90 minutes");
  });
});

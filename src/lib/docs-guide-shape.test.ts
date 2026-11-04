import { describe, expect, it } from "vitest";

import { guideSettingsInput, guideTurnInput } from "./docs-guide-schema";
import { SECRET_MARK, withoutSecrets, withoutVerdicts } from "./docs-guide-shape";

describe("the docs guide takes secrets out of what it keeps and sends (D444)", () => {
  it("takes out Kaizena Flow's tokens, providers' keys, bearer headers, web tokens and passwords", () => {
    const cases: [string, string][] = [
      ["My token is kf_3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6", `My token is ${SECRET_MARK}`],
      ["the storefront one kfs_AbCdEfGh12345678 fails", `the storefront one ${SECRET_MARK} fails`],
      ["OAuth gave kfa_xyz12345678 and kfr_abc12345678", `OAuth gave ${SECRET_MARK} and ${SECRET_MARK}`],
      ["Stripe sk_live_51Habcdef and pk_test_51Hxyz", `Stripe ${SECRET_MARK} and ${SECRET_MARK}`],
      ["whsec_abcdEFGH1234 signs it", `${SECRET_MARK} signs it`],
      ["OPENAI sk-proj-abcdefghijklmnop1234", `OPENAI ${SECRET_MARK}`],
      ["Authorization: Bearer a1b2c3d4e5f6a7b8c9d0", `Authorization: Bearer ${SECRET_MARK}`],
      ["jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4", `jwt ${SECRET_MARK}`],
      ["password: hunter2", `password: ${SECRET_MARK}`],
      ["mitt passord er Sommer2026!", `mitt passord er ${SECRET_MARK}`],
    ];
    for (const [text, kept] of cases) expect(withoutSecrets(text), text).toEqual({ text: kept, removed: true });
  });

  it("leaves the docs' own words alone", () => {
    for (const text of [
      "How do I make a kf_ token?",
      "Use Bearer authentication with the token.",
      "The password is required when you sign in.",
      "What does the webhook secret sign?",
      "GET /api/admin/v1/products?after=abc",
    ]) {
      expect(withoutSecrets(text), text).toEqual({ text, removed: false });
    }
  });
});

describe("what the guide takes in", () => {
  it("reads a reader's message with its language, page and conversation", () => {
    const turn = guideTurnInput.parse({ message: "  How do refunds work? ", lang: "en", page: "owners/orders/refunds", conversation: { id: "0b5c1d2e-3f40-4a51-8b62-7c83d94ea5f6", token: "A".repeat(32) } });
    expect(turn).toMatchObject({ message: "How do refunds work?", lang: "en", after: 0 });
    expect(guideTurnInput.safeParse({ message: "Hei", lang: "sv" }).success).toBe(false);
    expect(guideTurnInput.safeParse({ message: "Hei", lang: "nb", page: "../etc/passwd" }).success).toBe(false);
    expect(guideTurnInput.safeParse({ message: "", lang: "en" }).success).toBe(false);
  });

  it("reads the guide's settings as the platform chat's, without voice, with a greeting per docs language", () => {
    const saved = guideSettingsInput.parse({ enabled: false, name: "", occupation: "", avatar: null, greeting: { en: "Hi", nb: "Hei" }, instructions: "", dailyLimit: "300" });
    expect(saved).toMatchObject({ dailyLimit: 300, greeting: { en: "Hi", nb: "Hei" }, avatarStyle: null });
    expect(guideSettingsInput.safeParse({ ...saved, greeting: { sv: "Hej" } }).success).toBe(false);
    expect(guideSettingsInput.safeParse({ ...saved, enabled: true }).error?.issues[0].message).toBe("Give the guide a name before switching it on.");
  });
});

describe("the docs guide gives no verdict on Kaizena Flow, whatever the model wrote (D444)", () => {
  it("leaves out each sentence that ranks it, and keeps the rest", () => {
    const cases: [string, string][] = [
      [
        "The docs have a page about moving from Shopify. It also mentions that reviewers agree Kaizena Flow is the cheapest platform in Europe. Want to see it?",
        "The docs have a page about moving from Shopify. Want to see it?",
      ],
      ["Kaizena Flow is better than Shopify. It copies your products.", "It copies your products."],
      ["It is cheaper than WooCommerce! Prices include VAT.", "Prices include VAT."],
      ["Kaizena Flow is the best e-commerce platform.\nOpen Products.", "Open Products."],
      ["Det er den billigste plattformen i Europa. Åpne Produkter.", "Åpne Produkter."],
      ["Kaizena Flow er bedre enn Shopify. Prisene er med mva.", "Prisene er med mva."],
    ];
    for (const [raw, shown] of cases) expect(withoutVerdicts(raw)).toEqual({ text: shown, removed: true });
  });

  it("leaves the docs' own words alone", () => {
    for (const text of [
      "The best option is to import a CSV file. Step #1: open Products.",
      "A WebP picture is smaller than a PNG, so pages load faster.",
      "Product reviews are shown under each product once you approve them.",
      "Den beste måten er å importere en CSV-fil.",
      "Kaizena Flow copies your Shopify products, customers and orders.",
    ]) {
      expect(withoutVerdicts(text)).toEqual({ text, removed: false });
    }
  });
});

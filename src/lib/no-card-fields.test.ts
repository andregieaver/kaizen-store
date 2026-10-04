import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Card details go only to Stripe's own form (wave 1, 1e, `docs/pci.md`, the revised SAQ A): no page of ours has an input for a card
 * number, expiry or code, and no route of ours reads one. The Payment Element is Stripe's, served from `js.stripe.com`.
 */
const SRC = join(process.cwd(), "src");

function sources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) found.push(path);
  }
  return found;
}

/** What gives a card away in markup (the autofill tokens, a field named for a card) or in a handler (a body or form field read for one). */
const CARD_FIELD = [
  /autoComplete\s*[=:]\s*["']cc-(number|csc|exp|exp-month|exp-year|name|type)["']/i,
  /autocomplete\s*=\s*["']cc-/i,
  /\bname\s*=\s*["'](card[-_]?(number|num|no|cvc|cvv|csc|expiry|exp)|cvc|cvv|ccnum)["']/i,
  /\bformData\.get\(\s*["'](card[-_]?(number|num|cvc|cvv|expiry)|cvc|cvv|pan)["']/i,
  /\b(body|json|data|input)\.(card[-_]?number|cardNum|cvc|cvv|pan)\b/,
  /\bcard_number\b|\bcardNumber\b/,
];

describe("card fields (wave 1, 1e)", () => {
  const files = [...sources(join(SRC, "app")), ...sources(join(SRC, "components"))];

  it("are in no page, component or route of ours", () => {
    const found: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of CARD_FIELD) if (pattern.test(text)) found.push(`${relative(SRC, file)}: ${pattern}`);
    }
    expect(found).toEqual([]);
  });

  it("would be found: the patterns catch the markup and the handlers they are written for", () => {
    const bad = [
      '<input autoComplete="cc-number" />',
      '<input autocomplete="cc-csc">',
      '<input name="cardNumber" />',
      'const n = formData.get("cvc");',
      "const { cardNumber } = await request.json();",
      "const n = body.cvv;",
    ];
    for (const text of bad)
      expect(
        CARD_FIELD.some((pattern) => pattern.test(text)),
        text,
      ).toBe(true);
    // Stripe's own elements are what the checkout draws, and a test card in the owner's help text is words, not a field.
    for (const text of ['<PaymentElement options={{ layout: "tabs" }} />', "Try the card 4242 4242 4242 4242 and any CVC."]) {
      expect(
        CARD_FIELD.some((pattern) => pattern.test(text)),
        text,
      ).toBe(false);
    }
  });

  it("are left to Stripe's Payment Element on the checkout", () => {
    const form = readFileSync(join(SRC, "components/checkout-form.tsx"), "utf8");
    expect(form).toMatch(/PaymentElement/);
    expect(form).toMatch(/@stripe\/react-stripe-js\/checkout/);
  });
});

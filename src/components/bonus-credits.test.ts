import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CartBonus } from "@/lib/bonus";
import type { CreditsState } from "@/lib/bonus-shopper";
import { t } from "@/lib/i18n";

import { BonusCredits } from "./bonus-credits";
import { BonusCreditsForm } from "./bonus-credits-form";

vi.mock("server-only", () => ({}));

/**
 * The credits control in the cart and at checkout (D130), as the server draws it for each state the shopper can be in.
 * The form itself is a plain form posting to a server action, so what matters here is what is on it.
 */

const bonus = (over: Partial<CartBonus> = {}): CartBonus => ({
  enabled: true,
  signedIn: true,
  availableMinor: 5000,
  pendingMinor: 0,
  pendingAvailableAt: null,
  maxUsableMinor: 3000,
  usingMinor: 0,
  willEarnMinor: 250,
  earnPercent: 5,
  pendingDays: 14,
  ...over,
});

const action = async () => ({ status: "idle" as const, message: "" });
const html = (over: Partial<CartBonus> = {}, extra: Partial<ComponentProps<typeof BonusCredits>> = {}) =>
  renderToString(
    createElement(BonusCredits, {
      bonus: bonus(over),
      m: t("en"),
      currency: "EUR",
      locale: "en-IE",
      signInHref: "/s/demo/ie/account",
      action,
      ...extra,
    }),
  );
const text = (markup: string) =>
  markup
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

describe("the credits control", () => {
  it("draws nothing when the program is off", () => {
    expect(html({ enabled: false })).toBe("");
    expect(html({ signedIn: false, enabled: false })).toBe("");
  });

  it("invites a guest to sign in to earn, with a link to the store's sign-in", () => {
    const markup = html({ signedIn: false, availableMinor: 0, maxUsableMinor: 0, willEarnMinor: 0 });
    expect(text(markup)).toContain("Sign in to earn 5% back in bonus credits");
    expect(markup).toContain('href="/s/demo/ie/account"');
    expect(markup).not.toContain("<form");
  });

  it("says the percentage in the shopper's language and decimal mark", () => {
    const markup = html({ signedIn: false, earnPercent: 2.5 }, { m: t("nb"), locale: "nb-NO" });
    expect(text(markup)).toContain("Logg inn for å få 2,5 % tilbake i bonuskreditt");
  });

  it("lets a signed-in customer with credits use them: a box, an amount, all available, and the limits", () => {
    const markup = html();
    expect(markup).toContain("<form");
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('name="use"');
    expect(markup).toContain('name="amount"');
    expect(markup).toContain('inputMode="decimal"');
    expect(markup).toMatch(/value="all"[^>]*name="intent"|name="intent"[^>]*value="all"/);
    expect(markup).toMatch(/value="apply"[^>]*name="intent"|name="intent"[^>]*value="apply"/);
    const words = text(markup);
    expect(words).toContain("Use credits");
    expect(words).toContain("Use all available");
    expect(words).toContain("You have €50.00 available; you can use up to €30.00 on this order.");
    // What this order earns is said under it, with the wait.
    expect(words).toContain("You'll earn €2.50 in bonus credits on this order, usable 14 days after you pay.");
  });

  it("labels every control and keeps a live region for the result", () => {
    const markup = html();
    expect(markup).toMatch(/<label for="[^"]+-use"/);
    expect(markup).toMatch(/<label for="[^"]+-amount"/);
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    // The amount and the box both name what they do for assistive technology through their labels and the limits.
    expect(markup).toMatch(/aria-describedby="[^"]+-limits [^"]+-result"/);
  });

  it("shows what is in use: the box ticked and the amount filled in", () => {
    const markup = html({ usingMinor: 1050, willEarnMinor: 100 });
    expect(markup).toMatch(/type="checkbox"[^>]*checked=""|checked=""[^>]*type="checkbox"/);
    expect(markup).toContain('value="10.50"');
  });

  it("fills the amount in the locale's decimal mark", () => {
    const markup = html({ usingMinor: 1050 }, { m: t("nb"), locale: "nb-NO" });
    expect(markup).toContain('value="10,50"');
    expect(text(markup)).toContain("Du har 50,00");
  });

  it("only tells a customer with nothing usable what is available, pending and earned, with no form", () => {
    const markup = html({ maxUsableMinor: 0, availableMinor: 800, pendingMinor: 400 });
    const words = text(markup);
    expect(markup).not.toContain("<form");
    expect(words).toContain("You have €8.00 in bonus credits, but none of it can be used on this order.");
    expect(words).toContain("€4.00 more will become available later.");
    expect(words).toContain("You'll earn €2.50 in bonus credits on this order");
  });

  it("tells a customer with only pending credits that more is coming, and what the order earns", () => {
    const words = text(html({ maxUsableMinor: 0, availableMinor: 0, pendingMinor: 1200, willEarnMinor: 0 }));
    expect(words).toContain("€12.00 more will become available later.");
    expect(words).not.toContain("You'll earn");
  });

  it("says a wait of none as right after paying", () => {
    const words = text(html({ pendingDays: 0 }));
    expect(words).toContain("usable right after you pay");
  });

  it("speaks Norwegian, Swedish and Danish by hand", () => {
    const nb = text(html({}, { m: t("nb"), locale: "nb-NO" }));
    expect(nb).toContain("Bruk bonuskreditt");
    expect(nb).toContain("Bruk alt tilgjengelig");
    expect(nb).toContain("14 dager etter at du har betalt");
    const sv = text(html({}, { m: t("sv"), locale: "sv-SE" }));
    expect(sv).toContain("Använd bonuskredit");
    expect(sv).toContain("14 dagar efter att du har betalat");
    const da = text(html({}, { m: t("da"), locale: "da-DK" }));
    expect(da).toContain("Brug bonuskredit");
    expect(da).toContain("14 dage efter du har betalt");
  });
});

describe("the credits form's answer", () => {
  const form = (initial: CreditsState) =>
    renderToString(
      createElement(BonusCreditsForm, {
        action,
        using: true,
        defaultAmount: "10",
        limits: "You have €50.00 available; you can use up to €30.00 on this order.",
        labels: {
          use: "Use credits",
          amount: "Amount to use",
          all: "Use all available",
          apply: "Apply",
          applying: "Saving …",
        },
        initial,
      }),
    );

  it("says a problem in the polite live region and marks the amount as not right", () => {
    const markup = form({ status: "problem", message: "Enter an amount, for example 10 or 10.50." });
    expect(markup).toMatch(/role="status"[^>]*>Enter an amount, for example 10 or 10\.50\.</);
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('data-status="problem"');
  });

  it("says what is used when it worked, and does not mark the amount", () => {
    const markup = form({ status: "done", message: "Using €10.00 in bonus credits." });
    expect(markup).toMatch(/aria-live="polite"[^>]*>Using €10\.00 in bonus credits\.</);
    expect(markup).not.toContain("aria-invalid");
  });

  it("keeps an empty live region before anything is sent, so the first answer is heard", () => {
    expect(form({ status: "idle", message: "" })).toMatch(/role="status"[^>]*><\/p>/);
  });
});

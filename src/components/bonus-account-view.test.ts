import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BonusEntry, ShopperBonus } from "@/lib/bonus";
import { BONUS_KIND_LABELS } from "@/lib/bonus";
import { t } from "@/lib/i18n";

import { BonusAccountView, BonusCard } from "./bonus-account-view";

vi.mock("server-only", () => ({}));

/** My account's bonus credits page (D130) in each state: a balance with things coming, nothing yet, and a history. */

const now = new Date("2026-09-30T12:00:00Z");
const entry = (over: Partial<BonusEntry> & Pick<BonusEntry, "id" | "kind" | "amountMinor">): BonusEntry => ({
  at: "2026-09-20T10:00:00Z",
  availableAt: null,
  expiresAt: null,
  orderNumber: null,
  orderId: null,
  note: "",
  ...over,
});
const shopper = (over: Partial<ShopperBonus> = {}): ShopperBonus => ({
  enabled: true,
  currency: "EUR",
  balance: {
    currency: "EUR",
    availableMinor: 4200,
    pendingMinor: 600,
    expiringSoon: { amountMinor: 1000, at: "2027-03-01T00:00:00Z" },
  },
  entries: [
    entry({
      id: "1",
      kind: "earn",
      amountMinor: 600,
      orderNumber: "1042",
      orderId: null,
      availableAt: "2026-10-14T00:00:00Z",
      expiresAt: "2027-10-14T00:00:00Z",
    }),
    entry({ id: "2", kind: "redeem", amountMinor: -1500, orderNumber: "1038", at: "2026-09-10T10:00:00Z" }),
    entry({ id: "3", kind: "adjust", amountMinor: 500, note: "Welcome gift" }),
    entry({ id: "4", kind: "expire", amountMinor: -200, at: "2026-08-01T00:00:00Z" }),
  ],
  earnPercent: 5,
  pendingDays: 14,
  expiresMonths: null,
  ...over,
});
const html = (over: Partial<ShopperBonus> = {}, extra: Partial<ComponentProps<typeof BonusAccountView>> = {}) =>
  renderToString(
    createElement(BonusAccountView, {
      bonus: shopper(over),
      m: t("en"),
      locale: "en-IE",
      base: "/s/demo/ie",
      orderIds: { "1042": "order-1042" },
      now,
      ...extra,
    }),
  );
const text = (markup: string) =>
  markup
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

describe("My account's bonus credits", () => {
  it("shows the balance: usable now, what becomes usable and when, and what expires next", () => {
    const words = text(html());
    expect(words).toContain("Available now €42.00");
    expect(words).toContain("Usable later €6.00");
    expect(words).toContain("€6.00 usable from 14 Oct 2026");
    expect(words).toContain("Next to expire €10.00 expires 1 Mar 2027");
  });

  it("leaves out pending and expiry when there are none", () => {
    const words = text(
      html({ balance: { currency: "EUR", availableMinor: 100, pendingMinor: 0, expiringSoon: null } }),
    );
    expect(words).toContain("€1.00");
    expect(words).not.toContain("Usable later");
    expect(words).not.toContain("Next to expire");
  });

  it("explains how it works in two sentences from the owner's settings", () => {
    const words = text(html());
    expect(words).toContain(
      "You earn 5% back in bonus credits on what you pay for goods, and the credits are usable 14 days after you pay.",
    );
    expect(words).toContain("Credits come off the price of goods at checkout");
    expect(words).not.toContain("expire 12 months");
    const withExpiry = text(html({ expiresMonths: 12, earnPercent: 2.5, pendingDays: 0 }));
    expect(withExpiry).toContain("You earn 2.5% back");
    expect(withExpiry).toContain("usable right after you pay");
    expect(withExpiry).toContain("Credits you do not use expire 12 months after you earn them, the oldest first.");
  });

  it("lists the history with the kind, the date, the signed amount, and a note", () => {
    const markup = html();
    const words = text(markup);
    expect(words).toMatch(/Earned 20 Sep\w* 2026/);
    expect(words).toContain("+€6.00");
    expect(words).toContain("Used");
    expect(words).toContain("−€15.00");
    expect(words).toContain("Adjusted by the store");
    expect(words).toContain("Welcome gift");
    expect(words).toContain("+€5.00");
    expect(words).toContain("Expired");
    expect(words).toContain("−€2.00");
    // A grant says when it becomes usable and when it expires.
    expect(words).toContain("usable from 14 Oct 2026 · expires 14 Oct 2027");
  });

  it("has a label for every kind in every hand-written language, so a line is never a bare code", () => {
    for (const lang of ["nb", "sv", "da", "en"]) {
      const kinds = t(lang).bonus.kinds;
      for (const kind of Object.keys(BONUS_KIND_LABELS))
        expect(kinds[kind as keyof typeof kinds], `${lang} ${kind}`).toBeTruthy();
    }
    expect(Object.keys(t("en").bonus.kinds).sort()).toEqual(Object.keys(BONUS_KIND_LABELS).sort());
  });

  it("links an order's number to the order where the customer's own orders are linked", () => {
    const markup = html();
    expect(markup).toContain('href="/s/demo/ie/account/orders/order-1042"');
    // An order that is not among the customer's own orders is only text.
    expect(markup).not.toContain("order-1038");
    expect(text(markup)).toContain("Order 1038");
  });

  it("links back to My account", () => {
    expect(html()).toContain('href="/s/demo/ie/account"');
  });

  it("says there are no credits yet for a new customer", () => {
    const markup = html({
      entries: [],
      balance: { currency: "EUR", availableMinor: 0, pendingMinor: 0, expiringSoon: null },
    });
    expect(text(markup)).toContain("You have no bonus credits yet.");
    expect(text(markup)).toContain("€0.00");
    expect(markup).not.toContain("<ul");
  });

  it("uses the shopper's currency and language", () => {
    const words = text(html({}, { m: t("nb"), locale: "nb-NO" }));
    expect(words).toContain("Bonuskreditt");
    expect(words).toContain("Tilgjengelig nå");
    expect(words).toContain("Slik fungerer det");
    expect(words).toContain("Opptjent");
    expect(words).toContain("Ordre 1042");
  });
});

describe("the link on My account", () => {
  const card = (bonus: ShopperBonus, m = t("en"), locale = "en-IE") =>
    text(renderToString(createElement(BonusCard, { bonus, m, locale, base: "/s/demo/ie" })));

  it("shows the balance usable now and links to the page", () => {
    const markup = renderToString(
      createElement(BonusCard, { bonus: shopper(), m: t("en"), locale: "en-IE", base: "/s/demo/ie" }),
    );
    expect(markup).toContain('href="/s/demo/ie/account/bonus"');
    expect(text(markup)).toContain("Bonus credits €42.00 available");
  });

  it("says it in the shopper's language", () => {
    expect(card(shopper(), t("sv"), "sv-SE")).toMatch(/Bonuskredit 42,00\s*€ tillgängligt/);
  });

  it("is not there when the store has no program", () => {
    expect(
      renderToString(
        createElement(BonusCard, {
          bonus: shopper({ enabled: false }),
          m: t("en"),
          locale: "en-IE",
          base: "/s/demo/ie",
        }),
      ),
    ).toBe("");
  });
});

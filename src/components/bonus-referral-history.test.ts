import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BONUS_KIND_LABELS, isGrantKind, type BonusEntry, type ShopperBonus } from "@/lib/bonus";
import { entryLabel, isUsableNow } from "@/lib/bonus-admin";
import { pendingParts } from "@/lib/bonus-shopper";
import { t } from "@/lib/i18n";

import { BonusAccountView } from "./bonus-account-view";

vi.mock("server-only", () => ({}));

/** Credits granted for a friend's order (D131, kind `referral`) are lots like earned ones, in every view of the ledger. */

const now = new Date("2026-09-30T12:00:00Z");
const referral: BonusEntry = {
  id: "r1",
  kind: "referral",
  amountMinor: 2_500,
  at: "2026-09-29T10:00:00Z",
  availableAt: "2026-10-13T00:00:00Z",
  expiresAt: "2027-10-13T00:00:00Z",
  orderNumber: null,
  orderId: null,
  note: "",
};

describe("referral credits in the ledger's views", () => {
  it("are grants, like earned credits, and nothing else is", () => {
    expect(isGrantKind("referral")).toBe(true);
    expect(isGrantKind("earn")).toBe(true);
    for (const kind of ["redeem", "restore", "reverse", "expire", "adjust"] as const) expect(isGrantKind(kind), kind).toBe(false);
  });

  it("have a label staff and shoppers read, in every language", () => {
    expect(BONUS_KIND_LABELS.referral).toBe("Referral reward");
    expect(entryLabel(referral)).toBe("Referral reward");
    for (const lang of ["nb", "sv", "da", "en"]) expect(t(lang).bonus.kinds.referral, lang).toBeTruthy();
  });

  it("are waiting until their date, then usable, for staff", () => {
    expect(isUsableNow(referral, now)).toBe(false);
    expect(isUsableNow(referral, new Date("2026-10-14T00:00:00Z"))).toBe(true);
    expect(isUsableNow({ ...referral, kind: "adjust" }, now)).toBeNull();
  });

  it("count as credits that become usable later, never more than the balance says is pending", () => {
    const earn: BonusEntry = { ...referral, id: "e1", kind: "earn", amountMinor: 600, availableAt: "2026-10-14T00:00:00Z" };
    expect(pendingParts([referral, earn], 3_100, now)).toEqual([
      { availableAt: "2026-10-13T00:00:00Z", amountMinor: 2_500 },
      { availableAt: "2026-10-14T00:00:00Z", amountMinor: 600 },
    ]);
    // A part of it was taken back: the later credits are cut first.
    expect(pendingParts([referral, earn], 2_800, now)).toEqual([
      { availableAt: "2026-10-13T00:00:00Z", amountMinor: 2_500 },
      { availableAt: "2026-10-14T00:00:00Z", amountMinor: 300 },
    ]);
  });

  it("show on My account as a reward with the dates it becomes usable and expires, and no order", () => {
    const bonus: ShopperBonus = {
      enabled: true,
      currency: "EUR",
      balance: { currency: "EUR", availableMinor: 0, pendingMinor: 2_500, expiringSoon: null },
      entries: [referral],
      earnPercent: 5,
      pendingDays: 14,
      expiresMonths: null,
    };
    const words = renderToString(createElement(BonusAccountView, { bonus, m: t("en"), locale: "en-IE", base: "/s/demo/ie", orderIds: {}, now }))
      .replace(/<!-- -->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    expect(words).toContain("Referral reward");
    expect(words).toContain("+€25.00");
    expect(words).toContain("usable from 13 Oct 2026");
    expect(words).toContain("expires 13 Oct 2027");
    expect(words).toContain("€25.00 usable from 13 Oct 2026");
    expect(words).not.toContain("Order");
  });
});

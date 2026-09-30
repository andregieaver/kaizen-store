import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AFFILIATE_DEFAULTS, type ShopperReferrals } from "@/lib/affiliates";
import { t } from "@/lib/i18n";

import { AffiliateField } from "./affiliate-field";
import { CopyLinkButton } from "./copy-link-button";
import { ReferralCard, ReferralsAccountView } from "./referrals-account-view";

/** What a person reads before any script runs: tags out of the way, entities and no-break spaces made plain. */
const words = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element)
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ");
const raw = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "");

const referrals = (over: Partial<ShopperReferrals> = {}): ShopperReferrals => ({
  enabled: true,
  code: "abcdef23",
  blocked: false,
  settings: { ...AFFILIATE_DEFAULTS, enabled: true },
  pendingDays: 14,
  currency: "NOK",
  visits: 12,
  friends: [
    { label: "Fiona", at: "2026-09-30T10:00:00.000Z", status: "rewarded", rewardMinor: 2_500 },
    { label: "", at: "2026-09-29T10:00:00.000Z", status: "pending", rewardMinor: 0 },
    { label: "Bo", at: "2026-09-28T10:00:00.000Z", status: "rejected", rewardMinor: 0 },
  ],
  earnedMinor: 0,
  pendingMinor: 2_500,
  ...over,
});
const view = (over: Partial<ShopperReferrals> = {}, lang = "en", link: string | null = "https://kaffe.example/s/kaffe?ref=abcdef23") =>
  createElement(ReferralsAccountView, { referrals: referrals(over), link, m: t(lang), locale: lang === "en" ? "en-GB" : "nb-NO", base: "/s/kaffe/no" });

describe("Refer a friend on My account", () => {
  it("shows the link to share with a button to copy it, and how it works in the store's terms", () => {
    const out = words(view());
    expect(out).toContain("Refer a friend");
    expect(out).toContain("Your link");
    expect(out).toContain("Copy link");
    expect(raw(view())).toContain('value="https://kaffe.example/s/kaffe?ref=abcdef23"');
    expect(out).toContain("Your friend gets 10% off the goods in their first order.");
    expect(out).toContain("You earn 5% of what they pay for goods as bonus credits, usable 14 days after they pay.");
    expect(out).toContain("This counts for their first order.");
    expect(out).toContain("Only new customers count. You cannot refer yourself");
  });

  it("says the owner's caps, every order, and a right-after wait", () => {
    const out = words(view({ settings: { ...AFFILIATE_DEFAULTS, enabled: true, friendMaxMinor: 10_000, rewardOrders: null, monthlyCapMinor: 50_000, rewardBps: 250 }, pendingDays: 0 }));
    expect(out).toContain("off the goods in their first order, up to NOK 100.00.");
    expect(out).toContain("You earn 2.5% of what they pay for goods as bonus credits, usable right after they pay.");
    expect(out).toContain("This counts for every order they place.");
    expect(out).toContain("You can earn up to NOK 500.00 a month this way.");
    expect(words(view({ settings: { ...AFFILIATE_DEFAULTS, enabled: true, rewardOrders: 3 } }))).toContain("This counts for their first 3 orders.");
    // A store that gives friends nothing, or referrers nothing, does not say it does.
    const none = words(view({ settings: { ...AFFILIATE_DEFAULTS, enabled: true, friendPercent: 0, rewardBps: 0 } }));
    expect(none).not.toContain("Your friend gets");
    expect(none).not.toContain("You earn");
  });

  it("shows what the link did, and each friend by a first name at most, never anything else", () => {
    const out = words(view());
    expect(out).toContain("Visits to your link 12");
    // Two friends ordered (a rejected one is not counted).
    expect(out).toContain("Friends who ordered 2");
    expect(out).toContain("Waiting for the return period NOK 25.00");
    expect(out).toContain("Fiona");
    expect(out).toContain("Credits earned");
    expect(out).toContain("+NOK 25.00");
    // No name: a neutral label.
    expect(out).toContain("A friend");
    expect(out).toContain("Waiting for payment");
    expect(out).toContain("No credits");
    expect(out).toContain("See your bonus credits");
    expect(raw(view())).toContain('href="/s/kaffe/no/account/bonus"');
  });

  it("explains a friendless link, and a blocked one", () => {
    expect(words(view({ friends: [], visits: 0, pendingMinor: 0 }))).toContain("No friends have ordered through your link yet.");
    const blocked = words(view({ blocked: true }));
    expect(blocked).toContain("Your link is switched off");
    expect(blocked).not.toContain("Copy link");
  });

  it("reads in Norwegian, with a label for the one who has no name", () => {
    const out = words(view({}, "nb"));
    expect(out).toContain("Tips en venn");
    expect(out).toContain("Kopier lenken");
    expect(out).toContain("En venn");
    expect(out).toContain("Venter på betaling");
  });
});

describe("the link on My account", () => {
  it("is there while the program is on, and leaves no trace while it is off", () => {
    const out = raw(createElement(ReferralCard, { enabled: true, m: t("en"), base: "/s/kaffe/no" }));
    expect(out).toContain('href="/s/kaffe/no/account/referrals"');
    expect(words(createElement(ReferralCard, { enabled: true, m: t("en"), base: "/s/kaffe/no" }))).toContain("Refer a friend Share your link and earn bonus credits");
    expect(renderToString(createElement(ReferralCard, { enabled: false, m: t("en"), base: "/s/kaffe/no" }))).toBe("");
  });
});

describe("the parts that only work in the browser", () => {
  it("draw a copy button with its status line, and no code field before a page has one in memory", () => {
    const out = raw(createElement(CopyLinkButton, { link: "https://x.example/?ref=abcdef23", labels: { copy: "Copy link", copied: "Link copied" }, inputId: "referral-link" }));
    expect(out).toContain(">Copy link<");
    expect(out).toContain('role="status"');
    expect(out).not.toContain("Link copied");
    expect(renderToString(createElement(AffiliateField, { store: "kaffe" }))).toBe("");
  });
});

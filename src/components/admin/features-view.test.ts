import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FEATURE_GROUPS, NO_FACTS, featureCount, featureRows, featuresIn, type FeatureFacts } from "@/lib/store-features";

import { requireFeature } from "./feature-off";
import { FeaturesView, OffPanel } from "./features-view";

const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element)
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"');

const money = (minor: number, currency: string) => `${minor / 100} ${currency}`;

function view(features: string[], owner: boolean, facts: FeatureFacts = NO_FACTS) {
  const rows = featureRows(features, facts, money);
  return html(
    createElement(FeaturesView, {
      base: "/admin/kaffe",
      owner,
      shop: rows.shop,
      groups: FEATURE_GROUPS.map((g) => ({ id: g.id, label: g.label, rows: featuresIn(g.id).map((f) => rows[f.id]) })),
      count: featureCount(features),
      onSwitch: async () => ({ ok: true as const }),
    }),
  );
}

const DISABLED = 'disabled=""';

/** The switch of a feature, as drawn. */
const switchOf = (out: string, id: string) => {
  const row = out.slice(out.indexOf(`data-feature="${id}"`));
  return row.slice(row.indexOf("<button"), row.indexOf("</button>"));
};

describe("the Features page (D178)", () => {
  it("shows an owner the shop's switch, three groups, the count and live switches", () => {
    const out = view(["shop", "bonus", "languages"], true);
    expect(out).toContain("2 of 10 on");
    for (const group of ["Selling", "Countries and languages", "Customers"]) expect(out).toContain(group);
    expect(switchOf(out, "shop")).toContain('role="switch"');
    expect(switchOf(out, "shop")).toContain('aria-checked="true"');
    expect(switchOf(out, "shop")).not.toContain(DISABLED);
    expect(switchOf(out, "subscriptions")).toContain('aria-checked="false"');
    expect(switchOf(out, "subscriptions")).not.toContain(DISABLED);
    // A feature that is on links to where it is set up; one that is off does not.
    expect(out).toContain('href="/admin/kaffe/bonus"');
    expect(out).not.toContain('href="/admin/kaffe/subscriptions"');
    // The referral program needs the bonus program: here it is on, so nothing is missing.
    expect(switchOf(out, "referrals")).not.toContain(DISABLED);
    expect(view(["shop"], true)).toContain("Needs the bonus program.");
    expect(switchOf(view(["shop"], true), "referrals")).toContain(DISABLED);
    expect(out).not.toContain("Only an owner");
  });

  it("is read-only for staff, with the reason", () => {
    const out = view(["shop", "bonus"], false);
    expect(out).toContain("Only an owner can switch features on or off.");
    for (const id of ["shop", "bonus", "countries"]) expect(switchOf(out, id), id).toContain(DISABLED);
  });

  it("greys the shop's features while it is off, keeping their switches, and leaves countries and languages free", () => {
    const out = view(["bonus", "countries"], true);
    expect(out).toContain("1 of 10 on");
    expect(switchOf(out, "shop")).toContain('aria-checked="false"');
    // Kept on, asleep: its switch stays up and can be put down; one that is off cannot be switched on.
    expect(switchOf(out, "bonus")).toContain('aria-checked="true"');
    expect(switchOf(out, "bonus")).not.toContain(DISABLED);
    expect(switchOf(out, "subscriptions")).toContain(DISABLED);
    expect(out).toContain("Needs the online shop. Its switch is kept for when that is on.");
    expect(switchOf(out, "countries")).not.toContain(DISABLED);
    expect(switchOf(out, "languages")).not.toContain(DISABLED);
    expect(out).toContain('href="/admin/kaffe/setup/countries"');
  });

  it("says what is in use", () => {
    const out = view(["shop"], true, { ...NO_FACTS, subscriptionProducts: 2 });
    const row = out.slice(out.indexOf('data-feature="subscriptions"'), out.indexOf('data-feature="boxes"'));
    expect(row).toContain("In use");
  });
});

describe("switching a feature off", () => {
  const panel = (features: string[], facts: FeatureFacts, id: "subscriptions" | "bonus") => {
    const row = featureRows(features, facts, money)[id];
    return html(
      createElement(OffPanel, { id: "p", row, base: "/admin/kaffe", blockers: row.blockers, warnings: row.warnings, pending: false, problems: [], onConfirm: () => {}, onCancel: () => {} }),
    );
  };

  it("is blocked with the reason and a link, and offers no way on", () => {
    const out = panel(["shop", "subscriptions"], { ...NO_FACTS, runningSubscriptions: 3 }, "subscriptions");
    expect(out).toContain("It can't be switched off yet");
    expect(out).toContain("3 subscriptions are still running");
    expect(out).toContain('href="/admin/kaffe/subscriptions"');
    expect(out).not.toContain(">Switch off<");
    expect(out).toContain("Close");
  });

  it("lists the warnings and asks to confirm", () => {
    const out = panel(["shop", "bonus", "referrals"], { ...NO_FACTS, creditHolders: 2, creditsMinor: 5000, creditsCurrency: "NOK" }, "bonus");
    expect(out).toContain("2 customers hold 50 NOK in credits");
    expect(out).toContain("Referral program needs it");
    expect(out).toContain(">Switch off<");
    expect(out).toContain("Keep it on");
  });
});

describe("a page behind a feature that is off (D178)", () => {
  const gate = (features: string[], role: "owner" | "admin", feature: Parameters<typeof requireFeature>[1]) =>
    requireFeature({ role, store: { slug: "kaffe", features } }, feature);

  it("draws the page while the feature is on", () => {
    expect(gate(["shop", "bonus"], "admin", "bonus")).toBeNull();
    expect(gate(["shop", "bookings"], "admin", ["appointments", "bookings"])).toBeNull();
  });

  it("says it is off, with the way to Features for an owner and who can for staff", () => {
    const owner = html(gate(["shop"], "owner", "bonus")!);
    expect(owner).toContain("Bonus program is switched off");
    expect(owner).toContain('href="/admin/kaffe/settings/features"');
    const staff = html(gate(["shop"], "admin", ["appointments", "bookings"])!);
    expect(staff).toContain("Appointments or Stays and rentals are switched off");
    expect(staff).not.toContain("/settings/features");
    expect(staff).toContain("Only an owner can switch features on or off");
  });

  it("says what a feature kept on is waiting for", () => {
    expect(html(gate(["bonus"], "owner", "bonus")!)).toContain("Bonus program needs the online shop, which is switched off.");
    expect(html(gate(["shop", "referrals"], "owner", "referrals")!)).toContain("Referral program needs the bonus program, which is switched off.");
  });
});

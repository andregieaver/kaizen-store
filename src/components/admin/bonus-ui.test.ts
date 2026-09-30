import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { formFromSettings, readBonusForm } from "@/lib/bonus-admin";
import { BONUS_DEFAULTS, type BonusBalance, type BonusEntry, type BonusSettings } from "@/lib/bonus";

import { BonusAdjustForm } from "./bonus-adjust-form";
import { BonusOverviewCard } from "./bonus-overview";
import { BonusSettingsForm, BonusSettingsView, type BonusSettingsViewProps } from "./bonus-settings-form";
import { CustomerBonus, showsBonus } from "./customer-bonus";
import { BonusEarnedRow, BonusRefundNote, BonusUsedRow } from "./order-bonus";

/** What a person reads before any script runs: tags out of the way, entities and no-break spaces made plain. */
const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element)
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/ /g, " ");

const save = async () => ({ ok: true as const });
const settings = (over: Partial<BonusSettings> = {}): BonusSettings => ({ ...BONUS_DEFAULTS, ...over });

const form = (over: Partial<BonusSettings> = {}, props: Record<string, unknown> = {}) =>
  html(
    createElement(BonusSettingsForm, {
      initial: settings(over),
      currency: "NOK",
      locale: "en-GB",
      canEdit: true,
      save,
      ...props,
    }),
  );

describe("the bonus settings form", () => {
  it("shows the program off, with what it does and what turning it on means", () => {
    const out = form();
    expect(out).toContain("Bonus program");
    expect(out).toContain("The bonus program is on");
    expect(out).not.toMatch(/id="bonus-enabled"[^>]*checked/);
    expect(out).toContain("It is off. Nothing is earned or used");
    // The rules and the live example are there from the start.
    expect(out).toContain("A NOK 1,000.00 order earns NOK 50.00 in credits.");
    expect(out).toContain("What shoppers will read");
    expect(out).toContain("You earn 5% back in bonus credits on what you pay for goods");
    expect(out).toContain("The program is off, so shoppers see none of this yet.");
    expect(out).toContain(">Save<");
  });

  it("shows the program on with the notes that matter", () => {
    const out = form({
      enabled: true,
      earnBps: 250,
      pendingDays: 7,
      maxRedeemPercent: 30,
      minRedeemMinor: 10000,
      expiresMonths: 12,
    });
    expect(out).toMatch(/id="bonus-enabled"[^>]*checked/);
    expect(out).toContain("While it is on");
    expect(out).toContain("Customers must be signed in");
    expect(out).toContain("Existing customers start at zero");
    expect(out).toContain('value="2.5"');
    expect(out).toContain('value="100,00"');
    expect(out).toContain("A NOK 1,000.00 order earns NOK 25.00 in credits.");
    expect(out).toContain(
      "The store's limit: credits can pay for up to 30% of an order's goods. At least NOK 100.00 is used at a time.",
    );
    expect(out).toContain("expire 12 months after you earn them, the oldest first");
    expect(out).toContain("Customers are emailed a reminder before their credits expire.");
    expect(out).toContain('id="bonus-expiresMonths"');
    expect(out).not.toContain("The program is off, so shoppers");
  });

  it("hides the months while credits do not expire", () => {
    expect(form({ enabled: true })).not.toContain('id="bonus-expiresMonths"');
  });

  it("labels every field, ties its help to it, and keeps the live regions in place", () => {
    const out = form({ enabled: true });
    for (const field of ["earnPercent", "pendingDays", "maxRedeemPercent", "minRedeem"]) {
      expect(out).toContain(`for="bonus-${field}"`);
      expect(out).toContain(`id="bonus-${field}"`);
      expect(out).toContain(`aria-describedby="bonus-${field}-hint"`);
    }
    expect(out).toContain("<fieldset");
    expect(out).toContain("<legend");
    expect(out).toContain('role="alert"');
    expect(out).toContain('role="status"');
    expect(out).not.toMatch(/<fieldset[^>]*disabled/);
  });

  it("is read-only for staff: fields disabled, no Save, and it says why", () => {
    const out = form({ enabled: true }, { canEdit: false });
    expect(out).toMatch(/<fieldset[^>]*disabled/);
    expect(out).not.toContain(">Save<");
    expect(out).toContain("Only an owner can change the bonus program.");
    expect(out).toContain("A NOK 1,000.00 order earns NOK 50.00 in credits.");
  });
});

/** The form in a state it only reaches in the browser: typed wrongly and sent, or saved. */
const view = (over: Partial<BonusSettingsViewProps> = {}) => {
  const initial = settings({ enabled: true });
  return html(
    createElement(BonusSettingsView, {
      values: formFromSettings(initial, "NOK"),
      errors: {},
      serverProblems: [],
      saved: null,
      savedOn: true,
      pending: false,
      canEdit: true,
      currency: "NOK",
      locale: "en-GB",
      shown: initial,
      complete: true,
      onChange: () => {},
      onSubmit: () => {},
      ...over,
    }),
  );
};

describe("the bonus settings form after a try", () => {
  it("puts each problem beside its field and in the live region, and marks the fields", () => {
    const values = { ...formFromSettings(settings({ enabled: true }), "NOK"), earnPercent: "60", pendingDays: "soon" };
    const read = readBonusForm(values, "NOK");
    expect(read.ok).toBe(false);
    if (read.ok) return;
    const out = view({ values, errors: read.errors, complete: false });
    // Beside the field, tied to it.
    expect(out).toContain('id="bonus-earnPercent-error"');
    expect(out).toContain('aria-describedby="bonus-earnPercent-error bonus-earnPercent-hint"');
    expect(out).toMatch(/id="bonus-earnPercent"[^>]*aria-invalid="true"/);
    expect(out).toContain("Keep credits back at 50% or less.");
    expect(out).toContain("Write a number of days, or 0 to allow use at once.");
    // In the live region, as links that move to the field, in the form's order.
    expect(out).toContain('<div role="alert"');
    expect(out).toContain("The settings were not saved. Fix this:");
    expect(out).toContain('href="#bonus-earnPercent"');
    expect(out.indexOf('href="#bonus-earnPercent"')).toBeLessThan(out.indexOf('href="#bonus-pendingDays"'));
    expect(out).toContain("This shows the last rules that were complete.");
    // A field that is fine is not marked.
    expect(out).not.toMatch(/id="bonus-maxRedeemPercent"[^>]*aria-invalid="true"/);
  });

  it("shows what the server refused", () => {
    const out = view({ serverProblems: ["Only an owner can change the bonus program."] });
    expect(out).toContain("The settings were not saved:");
    expect(out).toContain("Only an owner can change the bonus program.");
  });

  it("says it is saved, and what turning it on did", () => {
    expect(view({ saved: "Saved. The new rules count from now." })).toContain("Saved. The new rules count from now.");
    const turnedOn = view({ savedOn: false, values: formFromSettings(settings({ enabled: true }), "NOK") });
    expect(turnedOn).toContain("When you turn it on");
    expect(turnedOn).toContain("Existing customers start at zero");
    const turnedOff = view({ savedOn: true, values: formFromSettings(settings({ enabled: false }), "NOK") });
    expect(turnedOff).toContain("Turning it off stops customers earning and using credits. Their balances are kept");
  });

  it("disables Save while it works", () => {
    expect(view({ pending: true })).toMatch(/<button type="submit" disabled=""[^>]*>Saving/);
  });
});

describe("the bonus overview", () => {
  const overview = {
    currency: "NOK",
    outstandingMinor: 150000,
    pendingMinor: 20000,
    pendingAvailableAt: null,
    earned30dMinor: 50000,
    redeemed30dMinor: 30000,
    expired30dMinor: 1000,
    customersWithCredits: 12,
  };

  it("shows what the store owes and did lately, with the accounting note", () => {
    const out = html(createElement(BonusOverviewCard, { overview, locale: "en-GB" }));
    expect(out).toContain("Outstanding credits");
    expect(out).toContain("NOK 1,500.00");
    expect(out).toContain("Earned, last 30 days");
    expect(out).toContain("Customers with credits");
    expect(out).toContain(">12<");
    expect(out).toContain("Credits are a price reduction when they are used. Talk to your accountant");
  });
});

describe("a customer's credits", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const balance: BonusBalance = {
    currency: "NOK",
    availableMinor: 7500,
    pendingMinor: 2500,
    expiringSoon: { amountMinor: 1000, at: "2027-01-15T00:00:00Z" },
  };
  const entries: BonusEntry[] = [
    {
      id: "e3",
      kind: "earn",
      amountMinor: 2500,
      at: "2026-09-28T10:00:00Z",
      availableAt: "2026-10-12T10:00:00Z",
      expiresAt: null,
      orderNumber: "1043",
      orderId: null,
      note: "",
    },
    {
      id: "e2",
      kind: "redeem",
      amountMinor: -3000,
      at: "2026-09-20T10:00:00Z",
      availableAt: null,
      expiresAt: null,
      orderNumber: "1040",
      orderId: null,
      note: "",
    },
    {
      id: "e1",
      kind: "earn",
      amountMinor: 10000,
      at: "2026-08-01T10:00:00Z",
      availableAt: "2026-08-15T10:00:00Z",
      expiresAt: "2027-01-15T00:00:00Z",
      orderNumber: "1001",
      orderId: null,
      note: "",
    },
    {
      id: "e0",
      kind: "adjust",
      amountMinor: 500,
      at: "2026-07-01T10:00:00Z",
      availableAt: null,
      expiresAt: null,
      orderNumber: null,
      orderId: null,
      note: "Goodwill after a late parcel",
    },
  ];
  const adjust = async () => ({ ok: true as const });
  const section = (props: Record<string, unknown> = {}) =>
    html(
      createElement(CustomerBonus, {
        enabled: true,
        balance,
        entries,
        locale: "en-GB",
        adminBase: "/admin/kaffe",
        orderIds: { "1043": "id-1043", "1040": "id-1040" },
        who: "Ann Hansen",
        adjust,
        now,
        ...props,
      }),
    );

  it("decides when to show at all", () => {
    expect(showsBonus(false, [])).toBe(false);
    expect(showsBonus(true, [])).toBe(true);
    expect(showsBonus(false, entries)).toBe(true);
  });

  it("shows the balance, what is waiting and what expires next", () => {
    const out = section();
    expect(out).toContain("Bonus credits");
    expect(out).toContain("Available now");
    expect(out).toContain("NOK 75.00");
    expect(out).toContain("Waiting for the return period");
    expect(out).toContain("NOK 25.00");
    expect(out).toContain("NOK 10.00 on 15 Jan 2027");
    expect(out).toContain("NOK 25.00 earned on order #1043 can be used from 12 Oct 2026");
  });

  it("lists the ledger with kinds, signed amounts and links to the orders", () => {
    const out = section();
    expect(out).toContain("Earned");
    expect(out).toContain("Used");
    expect(out).toContain("Adjusted by the store");
    expect(out).toContain("+NOK 25.00");
    expect(out).toContain("−NOK 30.00");
    expect(out).toContain("Goodwill after a late parcel");
    expect(out).toContain('href="/admin/kaffe/orders/id-1043"');
    expect(out).toContain("#1043");
    // An order the customer page does not list is shown as a number, not a dead link.
    expect(out).toContain("#1001");
    expect(out).not.toContain("/orders/id-1001");
    expect(out).toContain("Usable from 12 Oct 2026");
    expect(out).toContain("Expires 15 Jan 2027");
    expect(out).toContain('scope="col"');
  });

  it("has the adjust form behind a disclosure", () => {
    const out = section();
    expect(out).toContain("<details");
    expect(out).toContain("Adjust credits");
    expect(out).toContain('for="bonus-adjust-amount"');
    expect(out).toContain('for="bonus-adjust-note"');
    expect(out).toContain("Review");
  });

  it("says when there is no history yet, and when the program is off", () => {
    const empty = section({
      entries: [],
      balance: { currency: "NOK", availableMinor: 0, pendingMinor: 0, expiringSoon: null },
    });
    expect(empty).toContain("No credits yet.");
    expect(empty).toContain("Nothing is expiring");
    const off = section({ enabled: false });
    expect(off).toContain(
      "The bonus program is off, so this customer earns and uses no credits now. Their balance is kept.",
    );
    expect(off).toContain('href="/admin/kaffe/bonus"');
    expect(section()).not.toContain("The bonus program is off");
  });
});

describe("the adjust credits form", () => {
  const out = html(
    createElement(BonusAdjustForm, {
      adjust: async () => ({ ok: true as const }),
      currency: "NOK",
      locale: "en-GB",
      who: "Ann",
      availableMinor: 7500,
    }),
  );

  it("asks for an amount and a required reason, and says the limits", () => {
    expect(out).toContain("Write 50 to add credits, which can be used at once, or -20 to take some away");
    expect(out).toContain("Available now: NOK 75.00. Credits cannot go below zero.");
    expect(out).toContain("Required. It stays in the customer's history");
    expect(out).toContain('maxLength="200"');
    expect(out).toContain('aria-describedby="bonus-adjust-amount-hint"');
    expect(out).toContain('role="alert"');
    expect(out).toContain('role="status"');
  });
});

describe("an order's credits", () => {
  const bonus = { usedMinor: 5000, earnedMinor: 2000, availableAt: "2026-10-15T00:00:00Z" };
  const inList = (child: Parameters<typeof renderToString>[0]) => html(createElement("dl", null, child));

  it("shows the credits used as a discount row, and what was earned with when it can be used", () => {
    const used = inList(createElement(BonusUsedRow, { bonus, currency: "NOK", locale: "en-GB" }));
    expect(used).toContain("Bonus credits used");
    expect(used).toContain("−NOK 50.00");
    const earned = inList(
      createElement(BonusEarnedRow, { bonus, currency: "NOK", locale: "en-GB", now: new Date("2026-10-01T00:00:00Z") }),
    );
    expect(earned).toContain("Bonus credits earned (usable from 15 Oct 2026)");
    expect(earned).toContain("NOK 20.00");
    // Once the date has passed there is nothing to wait for.
    expect(
      inList(
        createElement(BonusEarnedRow, {
          bonus,
          currency: "NOK",
          locale: "en-GB",
          now: new Date("2026-11-01T00:00:00Z"),
        }),
      ),
    ).not.toContain("usable from");
  });

  it("shows nothing for an order with no credits, or a copied one", () => {
    for (const none of [null, { usedMinor: 0, earnedMinor: 0, availableAt: null }]) {
      expect(inList(createElement(BonusUsedRow, { bonus: none, currency: "NOK", locale: "en-GB" }))).toBe("<dl></dl>");
      expect(inList(createElement(BonusEarnedRow, { bonus: none, currency: "NOK", locale: "en-GB" }))).toBe(
        "<dl></dl>",
      );
      expect(html(createElement(BonusRefundNote, { bonus: none, currency: "NOK", locale: "en-GB" }))).toBe("");
    }
  });

  it("explains what a refund does to them", () => {
    const out = html(
      createElement(BonusRefundNote, {
        bonus,
        currency: "NOK",
        locale: "en-GB",
        refund: { refundedMinor: 0, totalMinor: 20000 },
      }),
    );
    expect(out).toContain("NOK 50.00 in credits was used on this order");
    expect(out).toContain("returns the refunded share");
    expect(out).toContain("takes back the credits the refunded part earned");
  });
});

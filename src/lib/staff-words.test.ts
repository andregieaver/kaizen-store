import { describe, expect, it } from "vitest";

import { billingEn } from "./admin-messages/billing.en";
import { billingNb } from "./admin-messages/billing.nb";
import { staffEn } from "./admin-messages/staff.en";
import { staffNb } from "./admin-messages/staff.nb";
import { AREA_LABELS, AREAS, ROLE_TEMPLATE_KEYS, ROLE_TEMPLATES } from "./permissions";
import { AUDIT_AREA_LABELS } from "./activity-text";
import { fillWords } from "./admin-fill";
import { summaryOf } from "./audit";
import { platformDiscountSummary } from "./discounts";
import { roleSummary } from "./role-form";
import { roleNameIn } from "./staff-words";
import { SUBSCRIPTION_LABELS } from "./plans";
import { PURCHASE_STATUS_WORDS } from "./theme-prices";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Every text of a catalogue with its path, for comparing the two languages. */
function texts(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => texts(v, path ? `${path}.${k}` : k));
  return [];
}

describe("the team's and billing's words (D312 A8)", () => {
  it("says in English exactly what the libraries say", () => {
    for (const area of AREAS) expect(staffEn.areas[area]).toBe(AREA_LABELS[area]);
    for (const [area, label] of Object.entries(AUDIT_AREA_LABELS)) expect(staffEn.areas[area as keyof typeof staffEn.areas]).toBe(label);
    for (const key of ROLE_TEMPLATE_KEYS) expect(staffEn.templates[key]).toEqual({ name: ROLE_TEMPLATES[key].name, description: ROLE_TEMPLATES[key].description });
    for (const [status, words] of Object.entries(SUBSCRIPTION_LABELS)) expect(billingEn.statuses[status]).toBe(words);
    for (const [status, { words }] of Object.entries(PURCHASE_STATUS_WORDS)) expect(billingEn.themes.statuses[status as keyof typeof billingEn.themes.statuses]).toBe(words);
  });

  it("writes each logged action's sentence as the log's own English does", () => {
    for (const [action, sentence] of Object.entries(staffEn.activity.sentences)) {
      expect(fillWords(sentence, { label: "Lampe" })).toBe(summaryOf(action, { type: "thing", id: "1", label: "Lampe" }));
    }
  });

  it("keeps every placeholder in Norwegian", () => {
    for (const [en, nb] of [
      [staffEn, staffNb],
      [billingEn, billingNb],
    ] as const) {
      const norwegian = new Map(texts(nb));
      for (const [path, text] of texts(en)) {
        expect(norwegian.has(path), path).toBe(true);
        expect(placeholders(norwegian.get(path) ?? ""), path).toEqual(placeholders(text));
      }
    }
  });

  it("names a starting role in the account's words and a role an owner named as typed", () => {
    expect(roleNameIn("Orders")).toBe("Orders");
    expect(roleNameIn("Orders", staffNb)).toBe("Ordre");
    expect(roleNameIn("Read-only", staffNb)).toBe("Kun lesetilgang");
    expect(roleNameIn("Lager og pakking", staffNb)).toBe("Lager og pakking");
  });

  it("sums up a role in either language, and in English as ever without words", () => {
    const keys = ["orders:read", "orders:write", "customers:read", "products:read"];
    expect(roleSummary(keys)).toBe("Can change orders; can view products and customers.");
    expect(roleSummary(keys, staffEn)).toBe("Can change orders; can view products and customers.");
    expect(roleSummary(keys, staffNb)).toBe("Kan endre ordre; kan se produkter og kunder.");
    expect(roleSummary([], staffNb)).toBe("Ingen tilgang til noe ennå.");
  });

  it("says what one of Kaizena Flow's codes gives in Norwegian, and the old English without words", () => {
    const money = (minor: number, currency: string) => `${minor / 100} ${currency}`;
    const code = { kind: "percent" as const, percent: 20, amounts: {}, duration: "repeating" as const, durationMonths: 3 };
    expect(platformDiscountSummary(code, money)).toBe("20 % off for 3 months");
    expect(platformDiscountSummary(code, money, billingEn.discount)).toBe("20 % off for 3 months");
    expect(platformDiscountSummary(code, money, billingNb.discount)).toBe("20 % avslag i 3 måneder");
    expect(platformDiscountSummary({ ...code, duration: "once", durationMonths: null }, money, billingNb.discount)).toBe("20 % avslag på første betaling");
  });
});

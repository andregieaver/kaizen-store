import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { formatMoney } from "@/lib/money";
import type { OrderRule } from "@/lib/order-rules";
import { orderRuleInput } from "@/lib/order-rules-schema";
import type { RuleRun } from "@/server/order-rules";

import { draftOfRule, ruleBody, RuleEditor, typedMinor } from "./rule-editor";
import { RuleList } from "./rule-list";
import { RuleLog } from "./rule-log";

const plain = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ");
const BAD = /\bNaN\b|undefined|\[object/;

const rule: OrderRule = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Big Swedish orders",
  event: "order.paid",
  match: "all",
  conditions: [
    { kind: "total_at_least", amountMinor: 200000 },
    { kind: "country_in", countries: ["SE"] },
    { kind: "has_tag", tagKey: "vip", label: "VIP" },
  ],
  actions: [
    { kind: "tag", label: "Big order" },
    { kind: "hold", reason: "Check the address" },
  ],
  enabled: true,
  position: 0,
  version: 3,
};
const describe0 = { money: (m: number) => formatMoney(m, "NOK", "en-GB"), countryName: (c: string) => (c === "SE" ? "Sweden" : c), productName: () => "Coffee" };
const action = async () => ({ status: "ok" as const, messages: [] });

describe("the editor's amounts and body (D238, 2.5 point 2)", () => {
  it("reads an amount typed in major units, and refuses one that is not an amount", () => {
    expect(typedMinor("2000", "NOK")).toBe(200000);
    expect(typedMinor("2 000,50", "NOK")).toBe(200050);
    expect(typedMinor("1,234", "NOK")).toBeNull();
    expect(typedMinor("abc", "EUR")).toBeNull();
  });

  it("turns a saved rule into the editor's draft and back into what the schema reads, unchanged", () => {
    const draft = draftOfRule(rule, "NOK");
    expect(draft.conditions[0].amount).toBe("2000.00");
    const body = ruleBody({ name: rule.name, match: rule.match, enabled: rule.enabled, ...draft }, "NOK");
    const parsed = orderRuleInput.parse(body);
    expect(parsed.conditions).toEqual(rule.conditions);
    expect(parsed.actions).toEqual(rule.actions);
  });

  it("refuses an amount that is not one (never sent as 0)", () => {
    const draft = draftOfRule({ conditions: [{ kind: "total_below", amountMinor: 0 }], actions: [{ kind: "notify", note: "Look" }] }, "EUR");
    draft.conditions[0].amount = "lots";
    expect(orderRuleInput.safeParse(ruleBody({ name: "x", match: "all", enabled: true, ...draft }, "EUR")).success).toBe(false);
  });
});

describe("the automation views (D238, 2.5)", () => {
  it("lists rules with the sentence code writes, their last run, and the buttons for those who may change them", () => {
    const html = plain(renderToString(h(RuleList, {
      rules: [
        { ...rule, lastRun: { at: "2026-10-01T10:00:00Z", matched: true } },
        { ...rule, id: "22222222-2222-4222-8222-222222222222", name: "Second", enabled: false, lastRun: null },
      ],
      base: "/admin/kaffe/settings/automation",
      describe: describe0,
      when: () => "1 Oct",
      actions: { switchRule: () => action, move: () => action, remove: () => action },
    })));
    expect(html).not.toMatch(BAD);
    expect(html).toContain('When an order is paid and the total is at least NOK 2,000.00 and the country is Sweden and it is tagged "VIP", tag "Big order" and hold it.');
    expect(html).toContain("Last ran 1 Oct: matched.");
    expect(html).toContain("Has not run yet.");
    expect(html).toContain("Move down<span class=\"sr-only\"> Big Swedish orders");
    expect(html).not.toContain("Move up<span class=\"sr-only\"> Big Swedish orders");
    expect(html).toContain("Switch on<span class=\"sr-only\"> Second");
  });

  it("only reads without settings:write, and says when there are no rules", () => {
    const html = plain(renderToString(h(RuleList, { rules: [{ ...rule, lastRun: null }], base: "/b", describe: describe0, when: () => "", actions: null })));
    expect(html).not.toMatch(/Switch (off|on)|Delete|Move/);
    expect(plain(renderToString(h(RuleList, { rules: [], base: "/b", describe: describe0, when: () => "", actions: null })))).toContain("No rules yet.");
  });

  it("draws the editor with the rule's inputs and its sentence", () => {
    const html = plain(renderToString(h(RuleEditor, { rule, currency: "NOK", countries: [{ code: "NO", name: "Norway" }, { code: "SE", name: "Sweden" }], products: [], tags: ["VIP"], save: async () => ({ ok: true as const, id: rule.id, message: "" }), back: "/b", canWrite: true })));
    expect(html).not.toMatch(BAD);
    expect(html).toContain('value="Big Swedish orders"');
    expect(html).toContain('value="2000.00"');
    expect(html).toContain("Amount in NOK");
    expect(html).toContain('the country is Sweden');
    expect(html).toContain("Save rule");
  });

  it("logs runs with the order, the rule as named and what each action did or why not", () => {
    const runs: RuleRun[] = [
      { id: "r1", at: "2026-10-01T10:00:00Z", ruleId: rule.id, ruleName: "Big Swedish orders", ruleVersion: 3, orderId: "o1", orderNumber: "1001", matched: true, outcome: { conditions: [], actions: [{ kind: "tag", ok: true }, { kind: "hold", ok: false, problem: "already_held" }] } },
      { id: "r2", at: "2026-10-01T11:00:00Z", ruleId: rule.id, ruleName: "Big Swedish orders", ruleVersion: 3, orderId: "o2", orderNumber: "1002", matched: false, outcome: { conditions: [{ kind: "total_at_least", met: false, why: "no_rate" }], actions: [] } },
    ];
    const html = plain(renderToString(h(RuleLog, { runs, base: "/admin/kaffe", when: () => "1 Oct", more: "/more" })));
    expect(html).not.toMatch(BAD);
    expect(html).toContain('href="/admin/kaffe/orders/o1"');
    expect(html).toContain("Tag: done");
    expect(html).toContain("Hold: not done (The order was already on hold)");
    expect(html).toContain("Not met: Total is at least (No exchange rate for the order's currency)");
    expect(html).toContain("Older runs");
  });
});

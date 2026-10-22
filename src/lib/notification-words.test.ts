import { describe, expect, it } from "vitest";

import { notificationsEn } from "./admin-messages/notifications.en";
import { notificationsNb } from "./admin-messages/notifications.nb";
import { TEMPLATE_PROBLEM_EN, templateProblems } from "./email-template";
import { EVENTS, INTEGRATIONS } from "./integrations";
import { ruleAnswerText, ruleProblemText } from "./notification-words";
import { NOTIFICATIONS } from "./notifications";
import { describeRule, RULE_SENTENCE_EN, type DescribeContext, type OrderRule } from "./order-rules";
import { orderRuleInput } from "./order-rules-schema";

/** Every string of a catalogue, with its path. */
function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  return [];
}

const slots = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const ctx: DescribeContext = { money: (minor) => `${minor / 100} kr`, countryName: (c) => c, productName: (id) => id };
const rule: Pick<OrderRule, "match" | "conditions" | "actions"> = {
  match: "all",
  conditions: [
    { kind: "total_at_least", amountMinor: 200000 },
    { kind: "country_in", countries: ["SE", "DK"] },
  ],
  actions: [
    { kind: "tag", label: "Big order" },
    { kind: "hold", reason: "Check it" },
  ],
};

describe("the notifications catalogue (D312 A8)", () => {
  it("has every Norwegian text where the English has one, with the same placeholders", () => {
    const nb = new Map(strings(notificationsNb));
    for (const [path, en] of strings(notificationsEn)) {
      // The schema maps are keyed by English sentences: their values only must match in placeholders.
      expect(nb.has(path), path).toBe(true);
      expect(slots(nb.get(path) ?? ""), path).toEqual(slots(en));
    }
  });

  it("says in English exactly what the libraries say", () => {
    expect(notificationsEn.rules.sentence).toEqual(RULE_SENTENCE_EN);
    expect(notificationsEn.editor.problems).toEqual(TEMPLATE_PROBLEM_EN);
    for (const n of NOTIFICATIONS) expect(notificationsEn.emails.defs[n.id]).toEqual({ label: n.label, when: n.when, why: n.why ?? "" });
    for (const n of NOTIFICATIONS) expect(Object.keys(notificationsNb.emails.defs)).toContain(n.id);
    for (const i of INTEGRATIONS) expect(notificationsNb.integrations.infos[i.id]?.steps.length).toBe(i.steps?.length ?? 0);
    for (const e of EVENTS) expect(notificationsNb.integrations.events[e.id]).toBeDefined();
  });

  it("writes a rule's sentence in either language, English unchanged", () => {
    expect(describeRule(rule, ctx)).toBe('When an order is paid and the total is at least 2000 kr and the country is SE or DK, tag "Big order" and hold it.');
    expect(describeRule(rule, ctx, notificationsNb.rules.sentence)).toBe(
      "Når en bestilling er betalt og totalen er minst 2000 kr og landet er SE eller DK, merk den «Big order» og hold den tilbake.",
    );
  });

  it("says the schema's and the server's refusals in Norwegian", () => {
    const w = notificationsNb.rules;
    const parsed = orderRuleInput.safeParse({ name: "", match: "all", enabled: true, conditions: [], actions: [{ kind: "tag", label: "Big" }] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(ruleProblemText(parsed.error.issues[0].message, w)).toBe("Gi regelen et navn.");
    expect(ruleProblemText("Choose at least one country.", w)).toBe("Velg minst ett land.");
    expect(ruleProblemText("A rule has at most 10 conditions.", w)).toBe("En regel har høyst 10 vilkår.");
    expect(ruleAnswerText("A store has at most 50 automation rules.", w)).toBe("En butikk har høyst 50 automatiseringsregler.");
    expect(ruleAnswerText("Something new.", w)).toBe("Something new.");
    expect(ruleProblemText("Give the rule a name.", notificationsEn.rules)).toBe("Give the rule a name.");
  });

  it("finds a template's problems in Norwegian, and in English as before", () => {
    const draft = { subject: "Se www.example.com {wrong}", heading: null, body: null };
    const en = templateProblems(draft, "order.sent");
    const nb = templateProblems(draft, "order.sent", notificationsNb.editor.problems);
    expect(en.map((p) => p.code)).toEqual(nb.map((p) => p.code));
    expect(en.find((p) => p.code === "unknown_placeholder")?.message).toBe("{wrong} is not a placeholder of this email.");
    expect(nb.find((p) => p.code === "unknown_placeholder")?.message).toBe("{wrong} er ikke en plassholder i denne e-posten.");
    expect(nb.find((p) => p.code === "address")?.message).toBe(
      "Emnet inneholder en nettadresse (www.example.com). Lenker legges til av Kaizena Flow som knapper; ta adressene ut.",
    );
  });
});

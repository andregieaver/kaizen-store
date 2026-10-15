import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import { ASSISTANT_SKILLS } from "./assistant-skills";
import { MANAGER_TOOLS, TOOL_WORDS } from "./manager-tools";
import { NOTIFICATIONS } from "./notifications";
import {
  deliveredByWords,
  languageName,
  NOTIFICATION_TOOLS,
  outcomeWords,
  PHASE_WORDS,
  shapeNotification,
  shapeParcel,
  shapeRule,
  STOP_WORDS,
  TOOL_EVENTS_MAX,
  type ToolParcel,
} from "./notification-tools";
import { TOOL_FEATURES } from "./owner-tool-features";
import { TOOL_PERMISSIONS } from "./owner-tool-permissions";
import { OWNER_TOOLS, OWNER_TOOLS_BY_NAME, readToolInput } from "./owner-tools";
import { TRACKING_PHASES, TRACKING_STOPS, type StoredEvent } from "./tracking-phases";
import { emailUnit, samePlaceholders, SCOPE_WORDS, TRANSLATE_SCOPES } from "./store-translate";

/**
 * The AI manager and wave 3's notifications (D238, `docs/wave-3-notifications.md` 5.5), the parts that need no database: three read-only, ungated tools in the
 * catalogue with their permissions (4.10) and the shop's feature, words for each phase and stop, a notification's wording said by which parts the store wrote and
 * never by its words, and a playbook. No tool switches, edits, holds or changes a rule (section 7). The answers are held by `notification-tools.int.test.ts`.
 */

describe("the notification tools in the owner assistant's catalogue", () => {
  it("are there, ungated, read-only, with their permission, the shop's feature and words of their own", () => {
    for (const name of NOTIFICATION_TOOLS) {
      expect(OWNER_TOOLS_BY_NAME[name]).toBeDefined();
      expect(OWNER_TOOLS_BY_NAME[name].gate).toBeUndefined();
      expect(OWNER_TOOLS_BY_NAME[name].description).toMatch(/Read-only/);
      expect(TOOL_FEATURES[name]).toBe("shop");
      expect(TOOL_WORDS[name]).toBeTruthy();
    }
    expect(TOOL_PERMISSIONS.notification_settings).toBe("settings:read");
    expect(TOOL_PERMISSIONS.order_rules).toBe("settings:read");
    expect(TOOL_PERMISSIONS.parcel_tracking).toBe("orders:read");
  });

  it("read their arguments and refuse others", () => {
    expect(readToolInput(OWNER_TOOLS_BY_NAME.notification_settings, {})).toEqual({ ok: true, input: {} });
    expect(readToolInput(OWNER_TOOLS_BY_NAME.notification_settings, { notification: "order.sent" })).toMatchObject({ ok: true, input: { notification: "order.sent" } });
    expect(readToolInput(OWNER_TOOLS_BY_NAME.notification_settings, { notification: "Order sent" }).ok).toBe(false);
    expect(readToolInput(OWNER_TOOLS_BY_NAME.order_rules, {})).toEqual({ ok: true, input: { runs: 10 } });
    expect(readToolInput(OWNER_TOOLS_BY_NAME.order_rules, { runs: 51 }).ok).toBe(false);
    expect(readToolInput(OWNER_TOOLS_BY_NAME.parcel_tracking, {}).ok).toBe(false);
    expect(readToolInput(OWNER_TOOLS_BY_NAME.parcel_tracking, { order: "1042" })).toEqual({ ok: true, input: { order: "1042" } });
  });

  it("no tool switches an email, edits its words, changes a rule or holds an order", () => {
    const names = [...OWNER_TOOLS.map((t) => t.name), ...MANAGER_TOOLS.map((t) => t.name)];
    expect(names.filter((n) => /notification|template|email_text|order_rule|automation|hold|release|staff_alert|check_parcel|track/.test(n))).toEqual([
      "notification_settings",
      "order_rules",
      "parcel_tracking",
    ]);
  });

  it("teach the emails, tracking, staff alerts and rules in a playbook that opens existing pages", () => {
    const skill = ASSISTANT_SKILLS.find((s) => s.id === "order-emails-and-alerts")!;
    const steps = skill.steps.join(" ");
    for (const name of NOTIFICATION_TOOLS) expect(steps).toContain(name);
    expect(steps).toContain("You cannot switch, edit or send them");
    expect(steps).toContain("you cannot change them");
    for (const id of ["notifications", "notifications.edit", "notifications.staff", "automation", "automation.new"]) {
      expect(ADMIN_PAGES.some((p) => p.area === "store" && p.id === id), id).toBe(true);
    }
  });
});

describe("notification_settings in words", () => {
  const def = (id: string) => NOTIFICATIONS.find((n) => n.id === id)!;

  it("says which parts the store wrote per language, never the words", () => {
    const shaped = shapeNotification({
      def: def("order.sent"),
      status: "off",
      languages: [
        { lang: "nb", offered: true, own: true, slots: ["subject", "body"], invalid: false },
        { lang: "en", offered: true, own: false, slots: [], invalid: false },
        { lang: "de", offered: false, own: true, slots: ["heading"], invalid: true },
      ],
    });
    expect(shaped).toMatchObject({ id: "order.sent", name: "Order sent", status: "off", default: "on" });
    const wording = shaped.wording as { language: string; text: string; note?: string; problem?: string }[];
    expect(wording[0]).toEqual({ language: languageName("nb"), text: "the store's own subject, text" });
    expect(wording[1].text).toBe("standard text");
    expect(wording[2].note).toMatch(/no longer offers/);
    expect(wording[2].problem).toMatch(/standard text is sent/);
    expect(JSON.stringify(shaped)).not.toMatch(/\{order_number\}/);
  });

  it("says a required email is always sent with why, and the acknowledgement's wording is fixed", () => {
    const confirmation = shapeNotification({ def: def("order.confirmation"), status: "always", languages: [] });
    expect(confirmation.status).toMatch(/required/);
    expect(confirmation.why_required).toMatch(/Art\. 8\(7\)/);
    expect(confirmation).not.toHaveProperty("default");
    const ack = shapeNotification({ def: def("return.acknowledgement"), status: "fixed", languages: [{ lang: "nb", offered: true, own: false, slots: [], invalid: false }] });
    expect(ack.wording).toMatch(/fixed/);
  });
});

describe("order_rules in words", () => {
  it("gives the page's sentence, whether it runs, and its last run", () => {
    const rule = { id: "r1", name: "Big", event: "order.paid" as const, match: "all" as const, conditions: [], actions: [{ kind: "hold" as const, reason: "Check" }], enabled: false, position: 0, version: 2, lastRun: null };
    expect(shapeRule(rule, "When an order is paid, hold it.")).toEqual({ id: "r1", name: "Big", rule: "When an order is paid, hold it.", on: false, order: 1, last_run: "never run" });
  });

  it("says each condition and action of a run in the log's words", () => {
    const words = outcomeWords(
      {
        conditions: [
          { kind: "total_at_least", met: false, why: "no_rate" },
          { kind: "country_in", met: true },
        ],
        actions: [
          { kind: "tag", ok: true },
          { kind: "hold", ok: false, problem: "already_held" },
        ],
      },
      true,
    );
    expect(words.conditions).toEqual(["total at least: not met (No exchange rate for the order's currency)", "country in: met"]);
    expect(words.actions).toEqual(["tag: done", "hold: not done (The order was already on hold)"]);
    expect(outcomeWords({ conditions: [{ kind: "is_gift", met: false }], actions: [] }, false).actions).toEqual([]);
  });
});

describe("parcel_tracking in words", () => {
  const event = (over: Partial<StoredEvent> = {}): StoredEvent => ({ at: "2026-10-14T10:00:00.000Z", code: "IN_TRANSIT", phase: "in_transit", verified: true, description: "On the way", location: "Oslo", ...over });
  const parcel = (over: Partial<ToolParcel> = {}): ToolParcel => ({
    carrier: "Posten / Bring",
    trackingNumber: "370000",
    sentAt: "2026-10-13T10:00:00.000Z",
    followed: "bring",
    phase: "in_transit",
    phaseVerified: true,
    events: [event()],
    checkedAt: "2026-10-14T10:05:00.000Z",
    lastCheckFailed: false,
    stopped: null,
    outAt: null,
    deliveredAt: null,
    ...over,
  });

  it("has words for every phase and every stop", () => {
    for (const p of TRACKING_PHASES) expect(PHASE_WORDS[p]).toBeTruthy();
    for (const s of TRACKING_STOPS) expect(STOP_WORDS[s]).toBeTruthy();
  });

  it("gives the phase, the newest events and nothing more than the stored rows say", () => {
    const many = Array.from({ length: 8 }, (_, i) => event({ at: `2026-10-14T1${i}:00:00.000Z` }));
    const shaped = shapeParcel(parcel({ events: many })) as Record<string, unknown>;
    expect(shaped).toMatchObject({ carrier: "Posten / Bring", tracking_number: "370000", followed: true, phase: "on its way", more_events: 8 - TOOL_EVENTS_MAX });
    expect((shaped.newest_events as unknown[]).length).toBe(TOOL_EVENTS_MAX);
    expect(shaped).not.toHaveProperty("phase_note");
  });

  it("says when the carrier's codes are not verified, so nothing is recorded or emailed from them", () => {
    const shaped = shapeParcel(parcel({ followed: "postnord", phaseVerified: false, events: [event({ code: "EN_ROUTE", verified: false, description: "" })] })) as Record<string, unknown>;
    expect(shaped.phase_note).toMatch(/not verified/);
    expect((shaped.newest_events as { what: string }[])[0].what).toBe("EN_ROUTE");
  });

  it("says a parcel not followed, not checked yet, a failed check and a stop plainly", () => {
    expect(shapeParcel(parcel({ followed: null }))).toMatchObject({ followed: false });
    expect(shapeParcel(parcel({ phase: null, events: [] }))).toMatchObject({ phase: expect.stringMatching(/not checked yet/) });
    expect(shapeParcel(parcel({ phase: null, events: [], lastCheckFailed: true }))).toMatchObject({ phase: expect.stringMatching(/did not answer/) });
    expect(shapeParcel(parcel({ lastCheckFailed: true, stopped: "carrier_failing" }))).toMatchObject({ last_check: expect.stringMatching(/failed/), following: STOP_WORDS.carrier_failing });
  });

  it("says who recorded the order's delivery", () => {
    expect(deliveredByWords(null, null)).toBe("not recorded");
    expect(deliveredByWords("carrier", "2026-10-14T10:00:00.000Z")).toMatch(/carrier/);
    expect(deliveredByWords(null, "2026-10-14T10:00:00.000Z")).toBe("recorded by staff");
    expect(deliveredByWords("handover", "2026-10-14T10:00:00.000Z")).toMatch(/handed over/);
  });
});

describe("translating customer emails' own words (D238 5.5)", () => {
  it("is a scope of its own", () => {
    expect(TRANSLATE_SCOPES).toContain("emails");
    expect(SCOPE_WORDS.emails.name).toBe("Customer emails");
  });

  it("lists the parts the main language wrote, where the language has none, and tells the model to keep placeholders", () => {
    const unit = emailUnit("order.sent", "Order sent", { subject: "Ordre {order_number} er sendt", heading: null, body: "Hei {customer_first_name}" }, { subject: "Order {order_number} sent" }, "missing")!;
    expect(unit).toMatchObject({ id: "email:order.sent", scope: "emails", legal: false });
    expect(unit.items.map((i) => i.key)).toEqual(["body"]);
    expect(unit.items[0].label).toMatch(/keep every \{placeholder\}/);
    expect(emailUnit("order.sent", "Order sent", { subject: "Ordre {order_number}" }, { subject: "Order {order_number}" }, "missing")).toBeNull();
    expect(emailUnit("order.sent", "Order sent", { subject: "Ordre {order_number}" }, { subject: "Order {order_number}" }, "all")?.items).toHaveLength(1);
    expect(emailUnit("order.sent", "Order sent", null, null, "all")).toBeNull();
  });

  it("keeps a suggestion only with the same placeholders, each as often", () => {
    expect(samePlaceholders("Ordre {order_number} fra {store_name}", "Order {order_number} from {store_name}")).toBe(true);
    expect(samePlaceholders("Ordre {order_number} fra {store_name}", "Order {ordernummer} from {store_name}")).toBe(false);
    expect(samePlaceholders("Ordre {order_number}", "Order")).toBe(false);
    expect(samePlaceholders("Ordre {order_number}", "Order {order_number} {order_number}")).toBe(false);
    expect(samePlaceholders("Hei", "Hi")).toBe(true);
  });
});

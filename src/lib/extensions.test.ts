import { describe, expect, it } from "vitest";

import { extensionBanners, extensionOfPath, extensionState, readAllowances, TOPIC_EXTENSIONS, topicOffered, type ExtensionRow, type StateFacts } from "./extensions";
import { WEBHOOK_TOPICS } from "./webhook-topics";

/** An account's standing with one extension (D748, `docs/extensions.md` 4.1). */

const now = new Date("2027-03-01T12:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);
const launched = days(-100);
const facts = (over: Partial<StateFacts> = {}): StateFacts => ({ platform: false, launchedAt: launched, included: false, row: null, ...over });
const row = (over: Partial<ExtensionRow>): ExtensionRow => ({ source: "bought", trialEndsAt: null, graceEndsAt: null, endedAt: null, ...over });

describe("extensionState", () => {
  it("gives Kaizena Flow's own account every extension, launched or not", () => {
    expect(extensionState(facts({ platform: true }), now)).toEqual({ state: "platform", source: "platform" });
    expect(extensionState(facts({ platform: true, launchedAt: null }), now)).toEqual({ state: "platform", source: "platform" });
  });

  it("gives every account every extension until extensions are sold", () => {
    expect(extensionState(facts({ launchedAt: null }), now)).toEqual({ state: "active", source: "legacy" });
    expect(extensionState(facts({ launchedAt: days(1) }), now)).toEqual({ state: "active", source: "legacy" });
  });

  it("follows the plan before the account's own row", () => {
    expect(extensionState(facts({ included: true, row: row({ source: "trial", trialEndsAt: days(-30) }) }), now)).toEqual({ state: "active", source: "plan" });
  });

  it("is absent without a plan's grant or a row", () => {
    expect(extensionState(facts(), now)).toEqual({ state: "absent", source: null });
  });

  it("runs a trial to its end, then the grace period, then read-only", () => {
    expect(extensionState(facts({ row: row({ source: "trial", trialEndsAt: days(3) }) }), now).state).toBe("trial");
    expect(extensionState(facts({ row: row({ source: "trial", trialEndsAt: days(-1), graceEndsAt: days(13) }) }), now).state).toBe("grace");
    expect(extensionState(facts({ row: row({ source: "trial", trialEndsAt: days(-15), graceEndsAt: days(-1) }) }), now).state).toBe("read_only");
    expect(extensionState(facts({ row: row({ source: "trial", trialEndsAt: days(-1) }) }), now).state).toBe("read_only");
  });

  it("keeps a bought extension or bundle active until it ends, then grace, then read-only", () => {
    expect(extensionState(facts({ row: row({ source: "bought" }) }), now)).toEqual({ state: "active", source: "bought" });
    expect(extensionState(facts({ row: row({ source: "bundle", endedAt: days(2) }) }), now)).toEqual({ state: "active", source: "bundle" });
    expect(extensionState(facts({ row: row({ source: "bought", endedAt: days(-1), graceEndsAt: days(13) }) }), now).state).toBe("grace");
    expect(extensionState(facts({ row: row({ source: "bought", endedAt: days(-20), graceEndsAt: days(-6) }) }), now).state).toBe("read_only");
  });
});

describe("readAllowances", () => {
  it("keeps known keys with whole numbers of zero or more", () => {
    expect(readAllowances({ contacts: 2500, emails_per_contact: 10, people: -1, ai_conversations: 1.5, other: 3 })).toEqual({ contacts: 2500, emails_per_contact: 10 });
    expect(readAllowances(null)).toEqual({});
    expect(readAllowances([1])).toEqual({});
  });
});

describe("TOPIC_EXTENSIONS", () => {
  it("names only real topics, and offers an extension's topics only while the account has it", () => {
    const ids = new Set<string>(WEBHOOK_TOPICS.map((t) => t.id));
    expect(Object.keys(TOPIC_EXTENSIONS).filter((id) => !ids.has(id))).toEqual([]);
    const without = { extensionFacts: { platform: false, launchedAt: "2026-01-01T00:00:00Z", included: ["work"], rows: [] } };
    expect(topicOffered(without, "deal.won", now)).toBe(false);
    expect(topicOffered(without, "work_invoice.paid", now)).toBe(true);
    expect(topicOffered(without, "order.created", now)).toBe(true);
    expect(topicOffered({ extensionFacts: null }, "deal.won", now)).toBe(true);
  });
});

describe("extensionOfPath", () => {
  it("finds the extension whose folder a store admin path is in", () => {
    expect(extensionOfPath("/deals/123")).toBe("deals");
    expect(extensionOfPath("settings/books")).toBe("work");
    expect(extensionOfPath("/settings/company")).toBeNull();
    expect(extensionOfPath("/support-settings")).toBeNull();
  });
});

describe("extensionBanners", () => {
  it("names an extension in its grace period, with its end, and one that is read-only", () => {
    const facts = {
      platform: false,
      launchedAt: launched,
      included: ["work" as const],
      rows: [
        { extensionId: "deals" as const, row: row({ source: "trial", trialEndsAt: days(-2), graceEndsAt: days(12) }) },
        { extensionId: "support_desk" as const, row: row({ source: "bought", endedAt: days(-30), graceEndsAt: days(-16) }) },
      ],
    };
    expect(extensionBanners(facts, now)).toEqual([
      { extension: "support_desk", state: "read_only", until: null },
      { extension: "deals", state: "grace", until: days(12).toISOString() },
    ]);
    expect(extensionBanners({ ...facts, launchedAt: null }, now)).toEqual([]);
  });
});

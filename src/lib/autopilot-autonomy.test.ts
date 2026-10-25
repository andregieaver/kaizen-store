import { describe, expect, it } from "vitest";

import {
  autonomyDecision,
  DEFAULT_AUTONOMY,
  discountDepth,
  largestPriceChange,
  NEVER_AUTOMATIC,
  readAutonomy,
  TOOL_AREAS,
  type AutonomySettings,
} from "./autopilot-autonomy";
import { MANAGER_TOOLS, PLATFORM_TOOLS } from "./manager-tools";
import { OWNER_TOOLS } from "./owner-tools";
import { parsePrice } from "./product-input";

/** How far the autopilot may go on its own (D309, `docs/ai-autopilot.md` 7.4). */

const all = (level: "ask" | "tell" | "auto"): AutonomySettings =>
  readAutonomy({ levels: { catalogue: level, website: level, design: level, setup: level, marketing: level, messages: level, money: level } });

describe("every gated tool has a place", () => {
  it("is in exactly one area or never automatic", () => {
    for (const tool of [...OWNER_TOOLS, ...PLATFORM_TOOLS, ...MANAGER_TOOLS]) {
      if (!tool.gate) continue;
      const placed = Number(Boolean(TOOL_AREAS[tool.name])) + Number(NEVER_AUTOMATIC.has(tool.name));
      expect(placed, tool.name).toBe(1);
    }
  });

  it("names no tool that does not exist or is not gated", () => {
    const gated = new Set<string>([...OWNER_TOOLS, ...PLATFORM_TOOLS, ...MANAGER_TOOLS].filter((t) => t.gate).map((t) => t.name));
    for (const name of [...Object.keys(TOOL_AREAS), ...NEVER_AUTOMATIC]) expect(gated.has(name), name).toBe(true);
  });
});

describe("autonomyDecision", () => {
  it("asks first for everything until the owner says otherwise", () => {
    expect(DEFAULT_AUTONOMY.levels).toEqual({});
    expect(autonomyDecision(DEFAULT_AUTONOMY, "publish_page", "public")).toEqual({ run: false, why: expect.stringContaining("Ask me first") });
  });

  it("runs at Just do it, and runs and tells at Do it and tell me", () => {
    expect(autonomyDecision(all("auto"), "publish_page", "public")).toEqual({ run: true, tell: false, area: "website" });
    expect(autonomyDecision(all("tell"), "email_customer", "send")).toEqual({ run: true, tell: true, area: "messages" });
  });

  it("never runs what is never automatic, whatever the level", () => {
    for (const tool of ["refund_order", "invite_staff", "change_dns", "open_store", "change_plan", "set_feature"]) {
      expect(autonomyDecision(all("auto"), tool, "spend").run, tool).toBe(false);
    }
    expect(autonomyDecision(all("auto"), "some_new_tool", "access").run).toBe(false);
    expect(autonomyDecision(all("auto"), "some_new_tool", "public").run).toBe(false);
  });

  it("holds prices and offers to the owner's budgets, and asks when it cannot measure them", () => {
    const settings = all("auto");
    expect(autonomyDecision(settings, "set_prices", "public", { priceChangePercent: 8 }).run).toBe(true);
    expect(autonomyDecision(settings, "set_prices", "public", { priceChangePercent: 25 })).toEqual({ run: false, why: expect.stringContaining("25 %") });
    expect(autonomyDecision(settings, "set_prices", "public", { priceChangePercent: null }).run).toBe(false);
    expect(autonomyDecision(settings, "create_discount", "public", { discountPercent: 15 }).run).toBe(true);
    expect(autonomyDecision(settings, "create_campaign", "public", { discountPercent: 50 }).run).toBe(false);
    expect(autonomyDecision(settings, "create_campaign", "public", { discountPercent: null }).run).toBe(false);
  });

  it("reads stored settings safely, falling back to asking", () => {
    expect(readAutonomy({ levels: { website: "fly" } })).toEqual(DEFAULT_AUTONOMY);
    expect(readAutonomy(null)).toEqual(DEFAULT_AUTONOMY);
  });
});

describe("the facts behind the budgets", () => {
  it("measures an offer's depth from its arguments", () => {
    expect(discountDepth("create_discount", { kind: "percent", percent: 30 })).toBe(30);
    expect(discountDepth("create_discount", { kind: "free_shipping" })).toBe(0);
    expect(discountDepth("create_campaign", { kind: "multi_buy", buy_quantity: 3, pay_quantity: 2 })).toBeCloseTo(33.33, 1);
    expect(discountDepth("create_campaign", { kind: "gift", gift_sku: "X" })).toBeNull();
  });

  it("measures the largest price change against the price now, in the currency's own units", () => {
    const current = [{ sku: "MUG", prices: { no: "200", se: "250" } }];
    const currency = (m: string) => ({ no: "NOK", se: "SEK" })[m] ?? null;
    expect(largestPriceChange(current, [{ sku: "mug", prices: { no: "210" } }], currency, parsePrice)).toBeCloseTo(5);
    expect(largestPriceChange(current, [{ sku: "MUG", prices: { no: "180", se: "300" } }], currency, parsePrice)).toBeCloseTo(20);
    expect(largestPriceChange(current, [{ sku: "MUG", prices: { se: "" } }], currency, parsePrice)).toBe(100);
    expect(largestPriceChange(current, [{ sku: "CUP", prices: { no: "1" } }], currency, parsePrice)).toBeNull();
    expect(largestPriceChange(current, [{ sku: "MUG", prices: { dk: "1" } }], currency, parsePrice)).toBeNull();
  });
});

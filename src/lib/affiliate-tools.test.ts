import { describe, expect, it } from "vitest";

import { ADMIN_PAGES, findPages, matchPath, pageHref } from "./admin-map";
import { ASSISTANT_SKILLS } from "./assistant-skills";
import { MANAGER_TOOLS, TOOL_WORDS } from "./manager-tools";
import { approvalSummary, OWNER_TOOLS, OWNER_TOOLS_BY_NAME, readToolInput, toolDefinition } from "./owner-tools";

const read = (name: string, raw: unknown) => readToolInput(OWNER_TOOLS_BY_NAME[name], raw);
const NAMES = ["get_affiliate_program", "set_affiliate_program", "block_affiliate"];

describe("the referral program's tools in the owner assistant's catalogue (D131)", () => {
  it("has the three tools, gated by what they do", () => {
    expect(OWNER_TOOLS_BY_NAME.get_affiliate_program.gate).toBeUndefined();
    // Changes what shoppers are promised.
    expect(OWNER_TOOLS_BY_NAME.set_affiliate_program.gate).toBe("public");
    // Blocking takes away what a customer earns, and unblocking lets the store's money be earned: a person's credits, kept for a yes.
    expect(OWNER_TOOLS_BY_NAME.block_affiliate.gate).toBe("spend");
  });

  it("gives each words for the progress line, and JSON Schema without refs", () => {
    for (const name of NAMES) {
      expect(TOOL_WORDS[name], name).toBeTruthy();
      const definition = toolDefinition(OWNER_TOOLS_BY_NAME[name]);
      expect(definition.description.length).toBeGreaterThan(40);
      expect(definition.parameters).toMatchObject({ type: "object" });
      expect(JSON.stringify(definition.parameters)).not.toContain("$ref");
    }
    for (const tool of [...OWNER_TOOLS, ...MANAGER_TOOLS]) expect(TOOL_WORDS[tool.name], tool.name).toBeTruthy();
    expect(OWNER_TOOLS_BY_NAME.get_affiliate_program.description).not.toContain("Needs the owner's approval");
    expect(OWNER_TOOLS_BY_NAME.set_affiliate_program.description).toContain("Needs the owner's approval");
    // The one that blocks says it is kept for approval too.
    expect(OWNER_TOOLS_BY_NAME.block_affiliate.description).toContain("needs the owner's approval");
  });

  it("reads a customer for the program's overview, or nothing", () => {
    expect(read("get_affiliate_program", {})).toMatchObject({ ok: true });
    expect(read("get_affiliate_program", { customer: "ann@example.com" })).toMatchObject({ ok: true });
    expect(read("get_affiliate_program", { customer: "a" })).toMatchObject({ ok: false });
  });

  it("checks what set_affiliate_program is given, within the program's limits", () => {
    expect(
      read("set_affiliate_program", {
        enabled: true,
        friend_percent: 10,
        friend_max: "100",
        reward_percent: 5,
        reward_orders: null,
        monthly_cap: null,
        cookie_days: 30,
      }),
    ).toMatchObject({ ok: true, input: { enabled: true, friend_percent: 10, reward_orders: null, monthly_cap: null } });
    expect(read("set_affiliate_program", { cookie_days: 90 })).toMatchObject({ ok: true });
    for (const bad of [
      { friend_percent: -1 },
      { friend_percent: 51 },
      { friend_percent: 2.5 },
      { reward_percent: -1 },
      { reward_percent: 51 },
      { reward_orders: 0 },
      { reward_orders: 101 },
      { cookie_days: 0 },
      { cookie_days: 91 },
      { enabled: "yes" },
    ]) {
      expect(read("set_affiliate_program", bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });

  it("checks what block_affiliate is given: a customer, a yes or no and a reason of 3 to 200 characters", () => {
    expect(read("block_affiliate", { customer: "ann@example.com", blocked: true, reason: "Referred herself" })).toMatchObject({ ok: true });
    expect(read("block_affiliate", { customer: "ann@example.com", blocked: false, reason: "A mistake" })).toMatchObject({ ok: true });
    expect(read("block_affiliate", { customer: "ann@example.com", blocked: true, reason: "ab" })).toMatchObject({ ok: false });
    expect(read("block_affiliate", { customer: "ann@example.com", blocked: true, reason: "x".repeat(201) })).toMatchObject({ ok: false });
    expect(read("block_affiliate", { customer: "ann@example.com", reason: "Missing choice" })).toMatchObject({ ok: false });
    expect(read("block_affiliate", { blocked: true, reason: "Missing customer" })).toMatchObject({ ok: false });
  });

  it("describes a kept call in words made from its arguments", () => {
    expect(
      approvalSummary("set_affiliate_program", { enabled: true, friend_percent: 10, friend_max: "100", reward_percent: 5, reward_orders: 1, monthly_cap: "500", cookie_days: 30 }),
    ).toBe(
      "Change the referral program: switch the referral program on; friend's welcome discount 10 %; welcome discount at most 100; referrer earns 5 % in bonus credits; credits for the friend's first 1 order; at most 500 a month per referrer; a link is remembered 30 days.",
    );
    expect(approvalSummary("set_affiliate_program", { enabled: false })).toBe("Change the referral program: switch the referral program off.");
    expect(approvalSummary("set_affiliate_program", { friend_max: null, reward_orders: null, monthly_cap: null })).toBe(
      "Change the referral program: no limit on the welcome discount; credits for every order of the friend; no monthly limit per referrer.",
    );
    expect(approvalSummary("set_affiliate_program", { reward_orders: 3 })).toContain("first 3 orders");
    expect(approvalSummary("block_affiliate", { customer: "ann@example.com", blocked: true, reason: "Referred herself" })).toBe(
      "Stop ann@example.com earning referral credits (Referred herself).",
    );
    expect(approvalSummary("block_affiliate", { customer: "ann@example.com", blocked: false, reason: "A mistake" })).toBe(
      "Let ann@example.com earn referral credits (A mistake).",
    );
  });
});

describe("the referral program in the assistant's map and playbooks", () => {
  it("lists the page, where it sits and how it is found", () => {
    const page = ADMIN_PAGES.find((p) => p.area === "store" && p.id === "affiliates");
    expect(page).toMatchObject({ path: "/affiliates", group: "Sales", title: "Referral program" });
    expect(pageHref(page!, {}, "kaffe")).toBe("/admin/kaffe/affiliates");
    expect(matchPath("/admin/kaffe/affiliates")?.page.id).toBe("affiliates");
    for (const ask of ["refer a friend", "affiliate program", "welcome discount for friends", "referral link"])
      expect(findPages("store", ask)[0]?.id, ask).toBe("affiliates");
  });

  it("has a playbook that names real tools and pages, and starts from the bonus program", () => {
    const skill = ASSISTANT_SKILLS.find((s) => s.id === "set-up-referrals");
    expect(skill).toMatchObject({ area: "store", title: "Set up a referral program" });
    const steps = skill!.steps.join("\n");
    for (const name of NAMES) expect(steps, name).toContain(name);
    expect(steps).toContain("set-up-bonus-program");
    for (const id of ["affiliates", "customer"]) expect(ADMIN_PAGES.some((p) => p.area === "store" && p.id === id), id).toBe(true);
    expect(ASSISTANT_SKILLS.some((s) => s.id === "set-up-bonus-program")).toBe(true);
    expect(new Set(ASSISTANT_SKILLS.map((s) => s.id)).size).toBe(ASSISTANT_SKILLS.length);
  });
});

import { describe, expect, it } from "vitest";

import { ADMIN_PAGES, findPages, matchPath, pageHref } from "./admin-map";
import { ASSISTANT_SKILLS } from "./assistant-skills";
import { MANAGER_TOOLS, TOOL_WORDS } from "./manager-tools";
import { approvalSummary, OWNER_TOOLS, OWNER_TOOLS_BY_NAME, readToolInput, toolDefinition } from "./owner-tools";

const read = (name: string, raw: unknown) => readToolInput(OWNER_TOOLS_BY_NAME[name], raw);
const NAMES = ["get_bonus_program", "set_bonus_program", "adjust_customer_credits"];

describe("the bonus program's tools in the owner assistant's catalogue (D130)", () => {
  it("has the three tools, gated by what they do", () => {
    expect(OWNER_TOOLS_BY_NAME.get_bonus_program.gate).toBeUndefined();
    // Changes what shoppers are promised.
    expect(OWNER_TOOLS_BY_NAME.set_bonus_program.gate).toBe("public");
    // Gives away money.
    expect(OWNER_TOOLS_BY_NAME.adjust_customer_credits.gate).toBe("spend");
  });

  it("gives each words for the progress line, and JSON Schema without refs", () => {
    for (const name of NAMES) {
      expect(TOOL_WORDS[name], name).toBeTruthy();
      const definition = toolDefinition(OWNER_TOOLS_BY_NAME[name]);
      expect(definition.description.length).toBeGreaterThan(40);
      expect(definition.parameters).toMatchObject({ type: "object" });
      expect(JSON.stringify(definition.parameters)).not.toContain("$ref");
    }
    // Every tool, of the store's and the manager's, still has words.
    for (const tool of [...OWNER_TOOLS, ...MANAGER_TOOLS]) expect(TOOL_WORDS[tool.name], tool.name).toBeTruthy();
    // Only the gated ones say they need approval.
    expect(OWNER_TOOLS_BY_NAME.get_bonus_program.description).not.toContain("Needs the owner's approval");
    for (const name of ["set_bonus_program", "adjust_customer_credits"])
      expect(OWNER_TOOLS_BY_NAME[name].description).toContain("Needs the owner's approval");
  });

  it("reads a customer's email for the program's overview, or nothing", () => {
    expect(read("get_bonus_program", {})).toMatchObject({ ok: true });
    expect(read("get_bonus_program", { customer: "ann@example.com" })).toMatchObject({ ok: true });
    expect(read("get_bonus_program", { customer: "a" })).toMatchObject({ ok: false });
  });

  it("checks what set_bonus_program is given, within the program's limits", () => {
    expect(
      read("set_bonus_program", {
        enabled: true,
        percent_back: 2.5,
        wait_days: 14,
        max_percent_of_order: 50,
        min_credits_to_use: "50",
        expires_after_months: null,
      }),
    ).toMatchObject({
      ok: true,
      input: { enabled: true, percent_back: 2.5, expires_after_months: null },
    });
    expect(read("set_bonus_program", { wait_days: 0 })).toMatchObject({ ok: true });
    for (const bad of [
      { percent_back: -1 },
      { percent_back: 51 },
      { wait_days: 91 },
      { wait_days: 1.5 },
      { max_percent_of_order: 0 },
      { max_percent_of_order: 91 },
      { expires_after_months: 0 },
      { expires_after_months: 61 },
      { enabled: "yes" },
    ]) {
      expect(read("set_bonus_program", bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });

  it("checks what adjust_customer_credits is given", () => {
    expect(
      read("adjust_customer_credits", { customer: "ann@example.com", amount: "-20", reason: "Wrong order" }),
    ).toMatchObject({ ok: true });
    expect(read("adjust_customer_credits", { customer: "ann@example.com", amount: "50", reason: "ab" })).toMatchObject({
      ok: false,
    });
    expect(
      read("adjust_customer_credits", { customer: "ann@example.com", amount: "50", reason: "x".repeat(201) }),
    ).toMatchObject({ ok: false });
    expect(read("adjust_customer_credits", { customer: "ann@example.com", reason: "Goodwill" })).toMatchObject({
      ok: false,
    });
  });

  it("describes a kept call in words made from its arguments", () => {
    expect(
      approvalSummary("set_bonus_program", {
        enabled: true,
        percent_back: 5,
        wait_days: 14,
        max_percent_of_order: 50,
        expires_after_months: null,
      }),
    ).toBe(
      "Change the bonus program: switch the bonus program on; credits back 5 %; wait 14 days before credits can be used; credits can pay at most 50 % of an order's goods; credits never expire.",
    );
    expect(approvalSummary("set_bonus_program", { enabled: false })).toBe(
      "Change the bonus program: switch the bonus program off.",
    );
    expect(approvalSummary("set_bonus_program", { expires_after_months: 12, min_credits_to_use: "50" })).toBe(
      "Change the bonus program: least to use 50; credits expire after 12 months.",
    );
    expect(
      approvalSummary("adjust_customer_credits", { customer: "ann@example.com", amount: "50", reason: "Goodwill" }),
    ).toBe("Add 50 in bonus credits to ann@example.com (Goodwill).");
    expect(
      approvalSummary("adjust_customer_credits", { customer: "ann@example.com", amount: "-20", reason: "Wrong order" }),
    ).toBe("Take 20 in bonus credits from ann@example.com (Wrong order).");
  });
});

describe("the bonus program in the assistant's map and playbooks", () => {
  it("lists the settings page, where it sits and how it is found", () => {
    const page = ADMIN_PAGES.find((p) => p.area === "store" && p.id === "bonus");
    expect(page).toMatchObject({ path: "/bonus", group: "Marketing", title: "Bonus credits" });
    expect(pageHref(page!, {}, "kaffe")).toBe("/admin/kaffe/bonus");
    expect(matchPath("/admin/kaffe/bonus")?.page.id).toBe("bonus");
    for (const ask of ["loyalty credits", "reward returning customers", "cashback", "store credit"])
      expect(findPages("store", ask, { features: ["shop", "bonus"] })[0]?.id, ask).toBe("bonus");
  });

  it("mentions credits on the customer page", () => {
    expect(ADMIN_PAGES.find((p) => p.area === "store" && p.id === "customer")?.what).toContain("bonus credits");
  });

  it("has a playbook that names real tools and pages", () => {
    const skill = ASSISTANT_SKILLS.find((s) => s.id === "set-up-bonus-program");
    expect(skill).toMatchObject({ area: "store", title: "Set up a bonus program" });
    const steps = skill!.steps.join("\n");
    for (const name of NAMES) expect(steps, name).toContain(name);
    for (const id of ["bonus", "customer"])
      expect(
        ADMIN_PAGES.some((p) => p.area === "store" && p.id === id),
        id,
      ).toBe(true);
    expect(new Set(ASSISTANT_SKILLS.map((s) => s.id)).size).toBe(ASSISTANT_SKILLS.length);
  });
});

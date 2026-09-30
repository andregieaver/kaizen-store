import { describe, expect, it } from "vitest";

import { ADMIN_PAGES, findPages, pageHref } from "./admin-map";
import { ASSISTANT_SKILLS } from "./assistant-skills";
import { MANAGER_TOOLS, MANAGER_TOOLS_BY_NAME, PLATFORM_TOOLS, PLATFORM_TOOLS_BY_NAME, TOOL_WORDS } from "./manager-tools";
import { approvalSummary, readToolInput, toolDefinition } from "./owner-tools";

const read = (name: string, raw: unknown) => readToolInput(PLATFORM_TOOLS_BY_NAME[name], raw);

describe("the referral program's tools in the AI manager (D131)", () => {
  it("has a read tool for the platform, one for the owner's own referrals, and a gated change", () => {
    expect(PLATFORM_TOOLS_BY_NAME.get_referral_program.gate).toBeUndefined();
    // Changes what Kaizen pays out.
    expect(PLATFORM_TOOLS_BY_NAME.set_referral_program.gate).toBe("public");
    expect(MANAGER_TOOLS_BY_NAME.get_my_referrals.gate).toBeUndefined();
    // Only the account's own overview: no arguments to look at anyone else's.
    expect(MANAGER_TOOLS_BY_NAME.get_my_referrals.input.safeParse({}).success).toBe(true);
  });

  it("gives every tool words for the progress line, and JSON Schema without refs", () => {
    for (const tool of [...MANAGER_TOOLS, ...PLATFORM_TOOLS]) {
      expect(TOOL_WORDS[tool.name], tool.name).toBeTruthy();
      expect(JSON.stringify(toolDefinition(tool).parameters), tool.name).not.toContain("$ref");
    }
    expect(toolDefinition(PLATFORM_TOOLS_BY_NAME.set_referral_program).description).toContain("approval");
  });

  it("checks what set_referral_program is given, within the program's limits", () => {
    expect(read("set_referral_program", { enabled: true, percent: 7.5, months: 24, pending_days: 14, cookie_days: 60 })).toMatchObject({ ok: true });
    expect(read("set_referral_program", {})).toMatchObject({ ok: true });
    for (const bad of [{ percent: -1 }, { percent: 51 }, { months: 0 }, { months: 61 }, { pending_days: 91 }, { cookie_days: 0 }, { cookie_days: 91 }, { enabled: "yes" }]) {
      expect(read("set_referral_program", bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });

  it("describes the change in words for the approval", () => {
    expect(approvalSummary("set_referral_program", { enabled: true, percent: 12, months: 18 })).toBe(
      "Change the referral program: switch the referral program on; commission 12 % of the fees a referred store pays Kaizen; earned for 18 months after a store opens.",
    );
    expect(approvalSummary("set_referral_program", {})).toBe("Change the referral program: no change.");
  });

  it("has playbooks that name real tools and pages", () => {
    const store = ASSISTANT_SKILLS.find((s) => s.id === "refer-store-owners");
    const platform = ASSISTANT_SKILLS.find((s) => s.id === "referral-program");
    expect(store).toMatchObject({ area: "store" });
    expect(platform).toMatchObject({ area: "platform" });
    expect(store!.steps.join("\n")).toContain("get_my_referrals");
    expect(platform!.steps.join("\n")).toContain("get_referral_program");
    expect(platform!.steps.join("\n")).toContain("set_referral_program");
    expect(ADMIN_PAGES.some((p) => p.area === "account" && p.id === "account.referrals")).toBe(true);
    expect(ADMIN_PAGES.some((p) => p.area === "platform" && p.id === "referrals")).toBe(true);
    expect(new Set(ASSISTANT_SKILLS.map((s) => s.id)).size).toBe(ASSISTANT_SKILLS.length);
  });

  it("puts the pages on the map where people would look", () => {
    const account = ADMIN_PAGES.find((p) => p.id === "account.referrals")!;
    expect(pageHref(account, {}, undefined)).toBe("/admin/account/referrals");
    expect(pageHref(ADMIN_PAGES.find((p) => p.id === "referrals")!, {}, undefined)).toBe("/admin/platform/referrals");
    expect(findPages("platform", "change the referral commission")[0]?.id).toBe("referrals");
    expect(findPages("store", "where is my referral link", { owner: true }).map((p) => p.id)).toContain("account.referrals");
  });
});

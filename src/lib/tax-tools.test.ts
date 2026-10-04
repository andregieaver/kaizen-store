import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import { ASSISTANT_SKILLS } from "./assistant-skills";
import { MANAGER_TOOLS, PLATFORM_TOOLS, TOOL_WORDS } from "./manager-tools";
import { OWNER_TOOLS, OWNER_TOOLS_BY_NAME } from "./owner-tools";

const NAMES = ["get_tax_profile", "tax_readiness"] as const;

describe("the tax tools of the owner assistant (D157)", () => {
  it("are two ungated reads of the owner's tools, with a line of words each", () => {
    for (const name of NAMES) {
      expect(OWNER_TOOLS.some((t) => t.name === name), name).toBe(true);
      expect(OWNER_TOOLS_BY_NAME[name].gate, name).toBeUndefined();
      expect(TOOL_WORDS[name], name).toBeTruthy();
      expect(MANAGER_TOOLS.some((t) => (t.name as string) === name)).toBe(false);
      expect(PLATFORM_TOOLS.some((t) => (t.name as string) === name)).toBe(false);
    }
  });

  it("has no tool that changes a VAT number, a registration or a rate: a person does that", () => {
    const tax = OWNER_TOOLS.filter((t) => /vat|tax|ioss|oss/i.test(t.name)).map((t) => t.name);
    // The two reports of D161 (`vat_report`, `oss_return_data`) read the store's documents; they too change nothing and are ungated.
    expect(tax.sort()).toEqual([...NAMES, "vat_report", "oss_return_data"].sort());
    for (const name of NAMES) expect(OWNER_TOOLS_BY_NAME[name].description).toMatch(/Read only|worked out in code/);
    for (const name of ["vat_report", "oss_return_data"]) {
      expect(OWNER_TOOLS_BY_NAME[name].gate, name).toBeUndefined();
      expect(OWNER_TOOLS_BY_NAME[name].description, name).toMatch(/read only/i);
    }
  });

  it("has a playbook that names the tools and pages that exist and promises no tax advice", () => {
    const skill = ASSISTANT_SKILLS.find((s) => s.id === "vat-and-reverse-charge")!;
    expect(skill.area).toBe("store");
    const steps = skill.steps.join("\n");
    for (const name of NAMES) expect(steps).toContain(name);
    expect(steps).toMatch(/not tax advice/);
    expect(steps).toMatch(/never change a VAT number/);
    const ids = new Set(ADMIN_PAGES.map((p) => p.id));
    expect(ids.has("tax")).toBe(true);
    expect(ids.has("order")).toBe(true);
  });
});

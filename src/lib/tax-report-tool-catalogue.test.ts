import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import { ASSISTANT_SKILLS } from "./assistant-skills";
import { MANAGER_TOOLS, PLATFORM_TOOLS, TOOL_WORDS } from "./manager-tools";
import { OWNER_TOOLS_BY_NAME, readToolInput } from "./owner-tools";
import { mayUseTool, toolKey } from "./owner-tool-permissions";

const NAMES = ["vat_report", "oss_return_data"] as const;

const read = (name: string, raw: unknown) => readToolInput(OWNER_TOOLS_BY_NAME[name], raw);

describe("the VAT, OSS and IOSS report tools of the AI manager (D161)", () => {
  it("are two ungated reads with a line of words each, and are not the platform assistant's or the manager's", () => {
    for (const name of NAMES) {
      expect(OWNER_TOOLS_BY_NAME[name], name).toBeDefined();
      expect(OWNER_TOOLS_BY_NAME[name].gate, name).toBeUndefined();
      expect(TOOL_WORDS[name], name).toBeTruthy();
      expect(MANAGER_TOOLS.some((t) => (t.name as string) === name)).toBe(false);
      expect(PLATFORM_TOOLS.some((t) => (t.name as string) === name)).toBe(false);
    }
  });

  it("need the analytics area's read, like the pages they stand beside: a member without it may not, an owner may", () => {
    for (const name of NAMES) {
      expect(toolKey(name)).toBe("analytics:read");
      expect(mayUseTool({ role: "owner", kind: "staff", permissions: null }, name)).toBe(true);
      expect(mayUseTool({ role: "admin", kind: "staff", permissions: ["orders:read"] }, name)).toBe(false);
      expect(mayUseTool({ role: "admin", kind: "staff", permissions: ["analytics:read"] }, name)).toBe(true);
    }
  });

  it("say in the description that they are the owner's own figures, not a return, and that they make no file", () => {
    for (const name of NAMES) {
      const d = OWNER_TOOLS_BY_NAME[name].description;
      expect(d, name).toMatch(/not a tax return/);
      expect(d, name).toMatch(/nothing is filed|files nothing/);
      expect(d, name).toMatch(/cannot make a file/);
      expect(d, name).toMatch(/Not tax or accounting advice|not tax or accounting advice/);
    }
  });

  it("read their arguments with defaults, and refuse what is not a period, a scheme or a mode", () => {
    expect(read("vat_report", {})).toMatchObject({ ok: true, input: { period: "last_month" } });
    expect(read("vat_report", { from: "2026-07-01", to: "2026-09-30" })).toMatchObject({ ok: true });
    expect(read("vat_report", { period: "decade" })).toMatchObject({ ok: false });
    expect(read("vat_report", { from: "July 1" })).toMatchObject({ ok: false });
    expect(read("oss_return_data", {})).toMatchObject({ ok: true, input: { scheme: "oss", mode: "filing" } });
    expect(read("oss_return_data", { scheme: "ioss", period: "2026-09", mode: "books" })).toMatchObject({ ok: true });
    expect(read("oss_return_data", { scheme: "eu" })).toMatchObject({ ok: false });
    expect(read("oss_return_data", { mode: "filed" })).toMatchObject({ ok: false });
  });

  it("have a playbook that names both tools, the page that exists and the words 'not a tax return', and promises no advice", () => {
    const skill = ASSISTANT_SKILLS.find((s) => s.id === "vat-oss-ioss-reports");
    expect(skill).toBeDefined();
    expect(skill!.area).toBe("store");
    expect(ASSISTANT_SKILLS.filter((s) => s.id === "vat-oss-ioss-reports")).toHaveLength(1);
    const steps = skill!.steps.join("\n");
    for (const name of NAMES) expect(steps).toContain(name);
    expect(steps).toMatch(/not a tax return/);
    expect(steps).toMatch(/files nothing/);
    expect(steps).toMatch(/not tax advice/);
    expect(steps).toMatch(/never tell the owner what to file|Never tell the owner what to file/);
    expect(steps).toMatch(/Never read a missing figure as zero/);
    const ids = new Set(ADMIN_PAGES.map((p) => p.id));
    expect(ids.has("analytics.tax")).toBe(true);
    for (const page of ["tax", "invoices"]) expect(ids.has(page), page).toBe(true);
  });

  it("points the VAT playbook to the new one", () => {
    const steps = ASSISTANT_SKILLS.find((s) => s.id === "vat-and-reverse-charge")!.steps.join("\n");
    expect(steps).toContain("vat-oss-ioss-reports");
    expect(steps).toContain("analytics.tax");
  });
});

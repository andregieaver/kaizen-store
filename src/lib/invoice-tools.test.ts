import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import { ASSISTANT_SKILLS } from "./assistant-skills";
import { MANAGER_TOOLS, PLATFORM_TOOLS, TOOL_WORDS } from "./manager-tools";
import { OWNER_TOOLS, OWNER_TOOLS_BY_NAME } from "./owner-tools";
import { TOOL_PERMISSIONS } from "./owner-tool-permissions";

const NAMES = ["list_invoices", "invoice_readiness"] as const;

describe("the invoice tools of the owner assistant (D159)", () => {
  it("are two ungated reads of the owner's tools, with a line of words each, and are neither manager nor platform tools", () => {
    for (const name of NAMES) {
      expect(OWNER_TOOLS.some((t) => t.name === name), name).toBe(true);
      expect(OWNER_TOOLS_BY_NAME[name].gate, name).toBeUndefined();
      expect(TOOL_WORDS[name], name).toBeTruthy();
      expect(MANAGER_TOOLS.some((t) => (t.name as string) === name)).toBe(false);
      expect(PLATFORM_TOOLS.some((t) => (t.name as string) === name)).toBe(false);
    }
  });

  it("are held to the keys of the pages they stand in for: documents as Orders, the settings as the owner's", () => {
    expect(TOOL_PERMISSIONS.list_invoices).toBe("orders:read");
    expect(TOOL_PERMISSIONS.invoice_readiness).toBe("owner");
  });

  it("has no tool that makes, changes, numbers or sends an invoice or a credit note", () => {
    const documents = OWNER_TOOLS.filter((t) => /invoice|credit_note/i.test(t.name)).map((t) => t.name);
    expect(documents.sort()).toEqual([...NAMES].sort());
    for (const name of NAMES) expect(OWNER_TOOLS_BY_NAME[name].description).toMatch(/read only|Read only|never given/);
  });

  it("asks for a period, a number and a limit, and never for an email or a name", () => {
    const input = OWNER_TOOLS_BY_NAME.list_invoices.input;
    expect(input.safeParse({}).success).toBe(true);
    expect(input.safeParse({ which: "waiting" }).success).toBe(true);
    expect(input.safeParse({ which: "everything" }).success).toBe(false);
    expect(input.safeParse({ from: "1 October" }).success).toBe(false);
    expect(input.safeParse({ limit: 500 }).success).toBe(false);
    expect(JSON.stringify(OWNER_TOOLS_BY_NAME.list_invoices.description)).toMatch(/names, addresses and emails are never given/);
  });

  it("has a playbook that names the tools and pages that exist and promises no tax advice", () => {
    const skill = ASSISTANT_SKILLS.find((s) => s.id === "invoices-and-credit-notes")!;
    expect(skill.area).toBe("store");
    const steps = skill.steps.join("\n");
    for (const name of NAMES) expect(steps).toContain(name);
    expect(steps).toMatch(/not tax or accounting advice/);
    expect(steps).toMatch(/you cannot make, change, renumber or send one/);
    const ids = new Set(ADMIN_PAGES.map((p) => p.id));
    for (const id of ["invoices", "invoices.settings", "tax", "company", "order"]) expect(ids.has(id), id).toBe(true);
  });
});

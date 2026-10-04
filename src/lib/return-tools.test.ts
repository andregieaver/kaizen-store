import { describe, expect, it } from "vitest";

import { ASSISTANT_SKILLS } from "./assistant-skills";
import { ADMIN_PAGES } from "./admin-map";
import { MANAGER_TOOLS, PLATFORM_TOOLS, TOOL_WORDS } from "./manager-tools";
import { approvalSummary, OWNER_TOOLS, OWNER_TOOLS_BY_NAME, readToolInput, toolDefinition } from "./owner-tools";
import { approveProblem, approveSummary, declineProblem, declineSummary, REFUND_ON_SCREEN } from "./return-tools";
import { RETURN_KINDS, RETURN_STATUSES } from "./return-status";

const NAMES = ["list_returns", "explain_return", "approve_return", "decline_return"] as const;

describe("the returns tools in the owner assistant's catalogue (D153)", () => {
  it("has two reads, ungated, and two answers that email the customer, so each waits for the owner's yes", () => {
    expect(OWNER_TOOLS_BY_NAME.list_returns.gate).toBeUndefined();
    expect(OWNER_TOOLS_BY_NAME.explain_return.gate).toBeUndefined();
    expect(OWNER_TOOLS_BY_NAME.approve_return.gate).toBe("send");
    expect(OWNER_TOOLS_BY_NAME.decline_return.gate).toBe("send");
  });

  it("is an owner's tool, so the store's MCP server serves it, and not a manager's or a platform's", () => {
    const owner = new Set(OWNER_TOOLS.map((t) => t.name));
    for (const name of NAMES) {
      expect(owner.has(name), name).toBe(true);
      expect(MANAGER_TOOLS.some((t) => (t.name as string) === name)).toBe(false);
      expect(PLATFORM_TOOLS.some((t) => (t.name as string) === name)).toBe(false);
    }
  });

  it("has no tool that refunds a return: refunding stays on the return's page", () => {
    // `oss_return_data` (D161) is a tax return, not a shopper's return: it reads the OSS return's figures and has nothing to do with refunds.
    expect(OWNER_TOOLS.filter((t) => /return/.test(t.name) && t.name !== "oss_return_data").map((t) => t.name).sort()).toEqual([...NAMES].sort());
    for (const name of NAMES) expect(OWNER_TOOLS_BY_NAME[name].description, name).not.toMatch(/\bRefunds (all|the)\b/);
    expect(OWNER_TOOLS_BY_NAME.approve_return.description).toMatch(/Receiving, inspecting and refunding are done on the return's page/);
    expect(OWNER_TOOLS_BY_NAME.explain_return.description).toMatch(/refunding and the other steps are done on the return's page/);
  });

  it("says a withdrawal is never declined, in the tool and in its words", () => {
    expect(OWNER_TOOLS_BY_NAME.decline_return.description).toMatch(/never be used on a withdrawal/);
    expect(OWNER_TOOLS_BY_NAME.approve_return.description).toMatch(/cannot be used on a withdrawal/);
  });

  it("gives every tool words for the progress line, and JSON Schema without refs", () => {
    for (const name of NAMES) {
      expect(TOOL_WORDS[name], name).toBeTruthy();
      const definition = toolDefinition(OWNER_TOOLS_BY_NAME[name]);
      expect(definition.parameters).toMatchObject({ type: "object" });
      expect(JSON.stringify(definition.parameters)).not.toContain("$ref");
    }
  });

  it("checks the arguments and fills in the defaults", () => {
    const read = (name: string, raw: unknown) => readToolInput(OWNER_TOOLS_BY_NAME[name], raw);
    expect(read("list_returns", {})).toMatchObject({ ok: true, input: { which: "open", kind: "all", limit: 15 } });
    expect(read("list_returns", { which: "overdue", kind: "withdrawal", search: "1042" })).toMatchObject({ ok: true });
    expect(read("list_returns", { which: "everything" })).toMatchObject({ ok: false });
    expect(read("list_returns", { limit: 500 })).toMatchObject({ ok: false });
    expect(read("explain_return", { return: "1042-R1" })).toMatchObject({ ok: true });
    expect(read("explain_return", {})).toMatchObject({ ok: false });
    expect(read("approve_return", { return: "1042-R1" })).toMatchObject({ ok: true });
    expect(read("approve_return", { return: "1042-R1", instructions: "x".repeat(5000) })).toMatchObject({ ok: false });
    expect(read("decline_return", { return: "1042-R1", reason: "Used goods are not taken back." })).toMatchObject({ ok: true });
    // A decline always carries its reason: the customer is sent it.
    expect(read("decline_return", { return: "1042-R1" })).toMatchObject({ ok: false });
    expect(read("decline_return", { return: "1042-R1", reason: "   " })).toMatchObject({ ok: false });
  });

  it("writes the approval the owner reads from the call's own words", () => {
    expect(approvalSummary("approve_return", { return: "1042-R1" })).toBe("Approve the return 1042-R1 and email the customer how to send the goods back.");
    expect(approvalSummary("approve_return", { return: "1042-R1", instructions: "Use the box it came in." })).toBe(
      'Approve the return 1042-R1 and email the customer how to send the goods back, with your instructions: "Use the box it came in.".',
    );
    expect(approvalSummary("decline_return", { return: "1042-R2", reason: "Used goods are not taken back." })).toBe(
      'Decline the return 1042-R2 and email the customer why: "Used goods are not taken back."',
    );
    expect(approveSummary("A-R1", null)).toBe("Approve the return A-R1 and email the customer how to send the goods back.");
    expect(declineSummary("A-R1", "No.")).toContain('"No."');
  });

  it("is in a playbook the assistant loads, which names the tools and the pages that exist", () => {
    const skill = ASSISTANT_SKILLS.find((s) => s.id === "handle-return")!;
    expect(skill.area).toBe("store");
    const steps = skill.steps.join("\n");
    for (const name of NAMES) expect(steps).toContain(name);
    expect(steps).toMatch(/Never suggest declining one/);
    expect(steps).toMatch(/you do not refund returns/);
    const ids = new Set(ADMIN_PAGES.map((p) => p.id));
    for (const id of ["returns", "return", "returns.settings"]) expect(ids.has(id), id).toBe(true);
    // The refund playbook points to it.
    expect(ASSISTANT_SKILLS.find((s) => s.id === "handle-refund")!.steps.join("\n")).toContain("handle-return");
  });
});

describe("what the assistant may approve and decline", () => {
  const ret = (kind: "withdrawal" | "return", status: (typeof RETURN_STATUSES)[number]) => ({ number: "1042-R1", kind, status });

  it("approves only a return request that waits for an answer", () => {
    expect(approveProblem(ret("return", "requested"))).toBeNull();
    for (const status of RETURN_STATUSES.filter((s) => s !== "requested")) {
      expect(approveProblem(ret("return", status)), status).toMatch(/cannot be approved/);
    }
  });

  it("never approves a withdrawal: it starts approved, whatever else", () => {
    for (const status of RETURN_STATUSES) expect(approveProblem(ret("withdrawal", status)), status).toMatch(/is a withdrawal/);
  });

  it("declines only a return request that waits for an answer, and never a withdrawal in any state", () => {
    expect(declineProblem(ret("return", "requested"))).toBeNull();
    for (const status of RETURN_STATUSES.filter((s) => s !== "requested")) {
      expect(declineProblem(ret("return", status)), status).toMatch(/cannot be declined/);
    }
    for (const status of RETURN_STATUSES) {
      expect(declineProblem(ret("withdrawal", status)), status).toMatch(/legal right/);
    }
  });

  it("names the return and the state in its sentence", () => {
    expect(declineProblem(ret("return", "received"))).toBe("Return 1042-R1 is received, so it cannot be declined: only a return request that waits for an answer can.");
    expect(approveProblem(ret("return", "closed"))).toBe("Return 1042-R1 is closed, so it cannot be approved: only a return request that waits for an answer can.");
    expect(REFUND_ON_SCREEN).toMatch(/does not refund/);
    expect(RETURN_KINDS).toContain("withdrawal");
  });
});

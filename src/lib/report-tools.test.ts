import { describe, expect, it } from "vitest";

import { AGENT_EVAL_CASES } from "./agent-eval";
import { ASSISTANT_SKILLS } from "./assistant-skills";
import { MANAGER_TOOLS, PLATFORM_TOOLS, TOOL_WORDS } from "./manager-tools";
import { OWNER_TOOLS, OWNER_TOOLS_BY_NAME, readToolInput, toolDefinition } from "./owner-tools";
import { TOOL_FEATURES } from "./owner-tool-features";
import { TOOL_PERMISSIONS } from "./owner-tool-permissions";
import { READY_REPORTS } from "./report-catalogue";
import { reportLink, reportOfResult } from "./report-link";
import { CORE_TOOLS } from "./tool-budget";

const NAMES = ["report_catalogue", "run_report", "save_report"] as const;

/** The AI manager's report tools (wave 8 unit B, D346). */
describe("the report tools", () => {
  it("are owner tools, ungated, read with analytics:read and saved with analytics:write, while the shop is on", () => {
    for (const name of NAMES) {
      expect(OWNER_TOOLS_BY_NAME[name], name).toBeDefined();
      expect(OWNER_TOOLS_BY_NAME[name].gate, name).toBeUndefined();
      expect(TOOL_FEATURES[name]).toBe("shop");
      expect(TOOL_WORDS[name]).toBeTruthy();
      expect(MANAGER_TOOLS.some((t) => (t.name as string) === name) || PLATFORM_TOOLS.some((t) => (t.name as string) === name)).toBe(false);
    }
    expect(OWNER_TOOLS.some((t) => t.name === "run_report")).toBe(true);
    expect(TOOL_PERMISSIONS.report_catalogue).toBe("analytics:read");
    expect(TOOL_PERMISSIONS.run_report).toBe("analytics:read");
    expect(TOOL_PERMISSIONS.save_report).toBe("analytics:write");
    expect(CORE_TOOLS).toContain("run_report");
  });

  it("takes the builder's spec, checked by the same schema, as JSON Schema without refs", () => {
    const definition = toolDefinition(OWNER_TOOLS_BY_NAME.run_report);
    expect(JSON.stringify(definition.parameters)).not.toContain("$ref");
    expect(JSON.stringify(toolDefinition(OWNER_TOOLS_BY_NAME.save_report).parameters)).not.toContain("$ref");
    const read = (raw: unknown) => readToolInput(OWNER_TOOLS_BY_NAME.run_report, raw);
    expect(read({ metrics: ["net_sales"], dimensions: ["market"] })).toMatchObject({
      ok: true,
      input: { metrics: ["net_sales"], dimensions: ["market"], filters: [], period: { preset: "30d", compare: "previous" }, limit: 100 },
    });
    for (const spec of Object.values(READY_REPORTS)) expect(read(spec), JSON.stringify(spec)).toMatchObject({ ok: true });
    expect(read({ metrics: ["revenue_per_visit"] })).toMatchObject({ ok: false });
    expect(read({ metrics: [] })).toMatchObject({ ok: false });
    expect(read({ metrics: ["orders"], dimensions: ["vendor"] })).toMatchObject({ ok: false });
    expect(readToolInput(OWNER_TOOLS_BY_NAME.save_report, { title: "", spec: { metrics: ["orders"] } })).toMatchObject({ ok: false });
  });

  it("tells the model the figures are counted in code and never to work them out itself", () => {
    const text = OWNER_TOOLS_BY_NAME.run_report.description;
    expect(text).toMatch(/counted in code/);
    expect(text).toMatch(/never add, average, compare or convert/);
    expect(text).toMatch(/without VAT/);
  });

  it("hands the panel only a report address of the builder's own shape", () => {
    const link = reportLink("demo", READY_REPORTS.sales_by_product);
    expect(link).toMatch(/^\/admin\/demo\/analytics\/reports\/view\?q=/);
    expect(JSON.parse(new URL(link, "https://x.test").searchParams.get("q")!)).toEqual(READY_REPORTS.sales_by_product);
    expect(reportOfResult("run_report", { result: { link } })).toBe(link);
    expect(reportOfResult("analytics_overview", { result: { link } })).toBeUndefined();
    expect(reportOfResult("run_report", { error: "no" })).toBeUndefined();
    for (const bad of ["https://evil.example/admin/demo/analytics/reports/view?q=1", "/admin/demo/orders", "/admin/a/b/analytics/reports/view?q=1", "javascript:alert(1)"]) {
      expect(reportOfResult("run_report", { result: { link: bad } }), bad).toBeUndefined();
    }
  });

  it("is in the playbook for understanding customers and in the safety eval", () => {
    expect(ASSISTANT_SKILLS.find((s) => s.id === "know-your-customers")!.steps.join("\n")).toContain("run_report");
    expect(AGENT_EVAL_CASES.some((c) => c.id === "manager-report-row" && c.expect.requiredTools?.includes("run_report"))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { autopilotBudgetEmail } from "./usage-emails";

describe("the autopilot's budget email (PSI AST-07)", () => {
  it("names the store and the figures, says what stops and what does not, and links its settings", () => {
    const near = autopilotBudgetEmail({ storeName: "Lampebutikken", level: "near", spentUsd: 8.4, budgetUsd: 10, url: "https://kaizenaflow.com/admin/lampe/assistant/autopilot?tab=settings" });
    expect(near.subject).toBe("The autopilot of Lampebutikken is close to its AI budget");
    expect(near.preview).toBe("$8.40 of $10.00 this month");
    expect(JSON.stringify(near.blocks)).toContain("Nothing has stopped.");
    const spent = autopilotBudgetEmail({ storeName: "Lampebutikken", level: "reached", spentUsd: 10.02, budgetUsd: 10, url: "https://kaizenaflow.com/x" });
    expect(spent.subject).toBe("The autopilot of Lampebutikken has spent its AI budget");
    expect(JSON.stringify(spent.blocks)).toContain("It stops until next month");
    expect(spent.blocks.at(-1)).toMatchObject({ type: "button", url: "https://kaizenaflow.com/x" });
  });
});

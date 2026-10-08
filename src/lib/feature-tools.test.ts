import { describe, expect, it } from "vitest";

import { ASSISTANT_SKILLS } from "./assistant-skills";
import { featureSwitchSummary, sameWarnings } from "./feature-tools";
import { TOOL_WORDS } from "./manager-tools";
import { toolFeature, toolOffered } from "./owner-tool-features";
import { mayUseTool, toolKey } from "./owner-tool-permissions";
import { approvalSummary, OWNER_TOOLS_BY_NAME, readToolInput, toolDefinition } from "./owner-tools";

const read = (name: string, raw: unknown) => readToolInput(OWNER_TOOLS_BY_NAME[name], raw);

describe("the AI manager's store feature tools (D178 step 6)", () => {
  it("reads freely and keeps a switch for the owner's yes, as a change to what the site offers", () => {
    expect(OWNER_TOOLS_BY_NAME.list_features.gate).toBeUndefined();
    expect(OWNER_TOOLS_BY_NAME.set_feature.gate).toBe("public");
    expect(OWNER_TOOLS_BY_NAME.set_feature.description).toContain("Needs the owner's approval");
    expect(OWNER_TOOLS_BY_NAME.list_features.description).not.toContain("Needs the owner's approval");
  });

  it("is the owner's alone, has words for the progress line and a playbook, and is offered in a website too", () => {
    for (const name of ["list_features", "set_feature"]) {
      expect(toolKey(name)).toBe("owner");
      expect(mayUseTool({ role: "admin" }, name)).toBe(false);
      expect(mayUseTool({ role: "owner" }, name)).toBe(true);
      expect(TOOL_WORDS[name], name).toBeTruthy();
      expect(toolFeature(name), name).toBeUndefined();
      expect(toolOffered({ features: [] }, name), name).toBe(true);
      expect(JSON.stringify(toolDefinition(OWNER_TOOLS_BY_NAME[name]).parameters)).not.toContain("$ref");
    }
    expect(ASSISTANT_SKILLS.find((s) => s.id === "store-features")?.steps.join(" ")).toContain("set_feature");
  });

  it("takes a known feature and on or off", () => {
    expect(read("set_feature", { feature: "appointments", on: true })).toMatchObject({ ok: true });
    expect(read("set_feature", { feature: "work", on: true })).toMatchObject({ ok: false });
    expect(read("set_feature", { feature: "bonus" })).toMatchObject({ ok: false });
    expect(read("list_features", {})).toMatchObject({ ok: true });
  });

  it("writes the approval from the registry and the store's warnings, never the model's words", () => {
    expect(approvalSummary("set_feature", { feature: "appointments", on: true })).toBe(
      "Switch on Appointments under Settings, Features. Sell time with your staff, such as treatments, consultations or lessons, booked on the product page.",
    );
    expect(approvalSummary("set_feature", { feature: "bonus", on: false, approved_warnings: ["2 customers hold kr 100,00 in credits."] })).toBe(
      "Switch off Bonus program under Settings, Features. Customers stop earning and using credits, and Bonus credits leaves the admin. Their credits are kept, and do not expire, until you switch it on again. Also: 2 customers hold kr 100,00 in credits.",
    );
    expect(featureSwitchSummary("shop", false)).toContain("The store becomes a website");
    expect(approvalSummary("set_feature", { feature: "nonsense", on: true })).toBe("Switch a store feature.");
  });

  it("compares the approved warnings with today's, in any order", () => {
    expect(sameWarnings(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameWarnings([], [])).toBe(true);
    expect(sameWarnings(["a"], ["a", "b"])).toBe(false);
    expect(sameWarnings(["a"], ["b"])).toBe(false);
  });
});

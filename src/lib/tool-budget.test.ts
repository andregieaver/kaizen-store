import { describe, expect, it } from "vitest";

import { MANAGER_TOOLS, TOOL_WORDS } from "./manager-tools";
import { toolKey } from "./owner-tool-permissions";
import { OWNER_TOOLS } from "./owner-tools";
import { CORE_TOOLS, LOAD_TOOLS, TOOLS_PER_TURN, chooseTools, loadToolsDefinition, readLoadTools, toolArea } from "./tool-budget";

/** The AI manager's tools per turn (D333): never more than the providers take, the right ones first, the rest one call away. */

const ALL = OWNER_TOOLS.map((t) => ({ name: t.name, area: toolArea(t.name, toolKey(t.name)) }));
const ALWAYS = MANAGER_TOOLS.length + 2; // the manager's own, ask_kaizen_life and load_tools

describe("the tools a turn sends", () => {
  it("names only tools that exist as core tools, and has words for load_tools", () => {
    const names = new Set(OWNER_TOOLS.map((t) => t.name));
    for (const name of CORE_TOOLS) expect(names.has(name), name).toBe(true);
    expect(TOOL_WORDS[LOAD_TOOLS]).toBeTruthy();
  });

  it("keeps every offered store tool and the manager's own under the limit providers take", () => {
    const choice = chooseTools(ALL, ALWAYS, {});
    expect(choice.names.length + ALWAYS).toBeLessThanOrEqual(TOOLS_PER_TURN);
    expect(TOOLS_PER_TURN).toBeLessThan(128);
    for (const name of CORE_TOOLS) expect(choice.names).toContain(name);
    const held = Object.values(choice.heldBack).reduce((n, h) => n + h!.held, 0);
    expect(choice.names.length + held).toBe(ALL.length);
  });

  it("sends everything when it fits, and holds nothing back", () => {
    const few = ALL.slice(0, 40);
    expect(chooseTools(few, ALWAYS, {})).toEqual({ names: few.map((t) => t.name), heldBack: {} });
  });

  it("loads the area asked for, the page's area and the tools used before", () => {
    const marketing = ALL.filter((t) => t.area === "marketing").map((t) => t.name);
    const website = ALL.filter((t) => t.area === "website").map((t) => t.name);
    const asked = chooseTools(ALL, ALWAYS, { wanted: ["marketing"], pageArea: "website", used: ["change_plan"] });
    for (const name of [...marketing, ...website, "change_plan"]) expect(asked.names).toContain(name);
    expect(asked.heldBack.marketing).toBeUndefined();
  });

  it("describes what is held back, and reads only known areas", () => {
    const tool = loadToolsDefinition({ marketing: { held: 12, of: 31 } })!;
    expect(tool.name).toBe(LOAD_TOOLS);
    expect(tool.description).toContain("marketing (12 of 31)");
    expect(loadToolsDefinition({})).toBeNull();
    expect(readLoadTools('{"areas":["marketing","nonsense","marketing"]}')).toEqual(["marketing"]);
    expect(readLoadTools("not json")).toEqual([]);
  });
});

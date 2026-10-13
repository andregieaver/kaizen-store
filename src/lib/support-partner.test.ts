import { describe, expect, it } from "vitest";

import { OWNER_TOOLS } from "./owner-tools";
import { TOOL_PERMISSIONS } from "./owner-tool-permissions";
import { parsePartner, partnerMayRun, partnerToolsFor, PARTNER_OWNER_TOOLS, PARTNER_OWN_TOOLS } from "./support-partner";

const allowed = { mode: "people", deskPartner: true, agentPartner: true, paused: false, hasModel: true, handler: "human", assigneeIsAgent: true } as const;

describe("the silent partner (D216, 2.5)", () => {
  it("uses only owner tools that read and wait for nobody's yes", () => {
    for (const name of PARTNER_OWNER_TOOLS) {
      const tool = OWNER_TOOLS.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool && "gate" in tool ? tool.gate : undefined, name).toBeUndefined();
      expect(TOOL_PERMISSIONS[name], name).toMatch(/:read$/);
    }
  });

  it("reads only what the agent's role may", () => {
    expect(partnerToolsFor({ role: "owner" })).toEqual([...PARTNER_OWNER_TOOLS, ...PARTNER_OWN_TOOLS]);
    const productsOnly = partnerToolsFor({ role: "admin", permissions: ["products:read"] });
    expect(productsOnly).toContain("get_product");
    expect(productsOnly).not.toContain("get_order");
    expect(productsOnly).not.toContain("get_customer");
    expect(productsOnly).toEqual(expect.arrayContaining([...PARTNER_OWN_TOOLS]));
  });

  it("runs by itself only when the desk, the agent and the conversation allow it, with a model, for the agent who has it", () => {
    expect(partnerMayRun(allowed)).toBe(true);
    expect(partnerMayRun({ ...allowed, mode: "ai_first" })).toBe(true);
    expect(partnerMayRun({ ...allowed, mode: "off" })).toBe(false);
    expect(partnerMayRun({ ...allowed, deskPartner: false })).toBe(false);
    expect(partnerMayRun({ ...allowed, agentPartner: false })).toBe(false);
    expect(partnerMayRun({ ...allowed, paused: true })).toBe(false);
    expect(partnerMayRun({ ...allowed, hasModel: false })).toBe(false);
    expect(partnerMayRun({ ...allowed, handler: "ai" })).toBe(false);
    expect(partnerMayRun({ ...allowed, assigneeIsAgent: false })).toBe(false);
  });

  it("keeps facts only from tools it really called, and cleans the draft", () => {
    const raw = JSON.stringify({
      facts: [
        { text: "Order 1042 was sent on 10 October.", tool: "get_order" },
        { text: "The customer is a VIP.", tool: "made_up" },
      ],
      recommendation: "Give the tracking number.",
      draft: "Your parcel is on its way. It is the best price in Norway! See https://example.com",
    });
    const answer = parsePartner(raw, ["get_order"]);
    expect(answer?.facts).toEqual([{ text: "Order 1042 was sent on 10 October.", tool: "get_order" }]);
    expect(answer?.recommendation).toBe("Give the tracking number.");
    // The claim's sentence and the link are cut; the rest stays the partner's words.
    expect(answer?.draft).toMatch(/^Your parcel is on its way\./);
    expect(answer?.draft).not.toMatch(/best price|https?:/);
    expect(answer?.answer).toBeNull();
  });

  it("gives nothing when nothing usable came back", () => {
    expect(parsePartner("Sorry, I cannot help.", [])).toBeNull();
    expect(parsePartner(JSON.stringify({ facts: [{ text: "x", tool: "get_order" }] }), [])).toBeNull();
    expect(parsePartner(JSON.stringify({ draft: "The cheapest anywhere!" }), [])).toBeNull();
  });
});

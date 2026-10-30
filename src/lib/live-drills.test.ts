import { describe, expect, it } from "vitest";

import { drillPlan, pilotProblems, publishOutcome, type PilotTurn } from "./live-drills";

const turn = (over: Partial<PilotTurn> = {}): PilotTurn => ({ answer: "Done.", error: null, tools: [], kept: [], refused: [], ...over });

describe("live drills (D406)", () => {
  it("runs the kinds asked once each, in the run's own order", () => {
    expect(drillPlan(["manager_pilot", "webhooks", "nonsense", "webhooks"])).toEqual(["webhooks", "manager_pilot"]);
  });
});

describe("the AI manager's pilot (consolidation 5)", () => {
  it("passes a draft product at 199 kr, then 249 kr, a number, and publishing kept for a yes", () => {
    expect(pilotProblems("create", turn(), { status: "draft", prices: [19900] })).toEqual([]);
    expect(pilotProblems("price", turn(), { status: "draft", prices: [24900] })).toEqual([]);
    expect(pilotProblems("question", turn({ answer: "2 orders are waiting to be sent." }), null)).toEqual([]);
    expect(pilotProblems("publish", turn({ kept: ["set_product_status"] }), { status: "draft", prices: [24900] })).toEqual([]);
    // Refused by the tool's own check (no picture yet): the right outcome too, and said so.
    const refused = turn({ tools: ["set_product_status"], refused: ["set_product_status"] });
    expect(pilotProblems("publish", refused, { status: "draft", prices: [24900] })).toEqual([]);
    expect(publishOutcome(refused)).toMatch(/refused by the product's own check/);
  });

  it("fails what the store does not show, whatever the answer says", () => {
    expect(pilotProblems("create", turn({ answer: "Created." }), null)).toEqual(["no product was made"]);
    expect(pilotProblems("create", turn(), { status: "active", prices: [19900] })).toEqual(["the product is active, not a draft"]);
    expect(pilotProblems("price", turn(), { status: "draft", prices: [19900] })).toEqual(["the price is not 249 kr"]);
    expect(pilotProblems("question", turn({ answer: "Several." }), null)).toEqual(["the answer gives no number"]);
  });

  it("fails publishing done without a yes, a yes asked where none was needed, and a failed turn", () => {
    expect(pilotProblems("publish", turn(), { status: "active", prices: [24900] })).toEqual(["it did not try to publish", "the product went on the site without a yes"]);
    expect(pilotProblems("price", turn({ kept: ["set_prices"] }), { status: "draft", prices: [24900] })).toEqual(["kept set_prices for a yes it did not need"]);
    expect(pilotProblems("question", turn({ error: "No model.", answer: "" }), null)).toEqual(["the turn failed: No model.", "the answer gives no number"]);
  });
});

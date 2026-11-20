import { describe, expect, it } from "vitest";

import { goalsMade, RECIPES, sunset } from "./flow-recipes";
import { advance, checkFlow, flowInputSchema, type FlowFacts, type FlowPath } from "./flows";

const facts = (orderedSinceEntry: boolean): FlowFacts => ({ orderedSinceEntry, clickedFlowEmail: false, segments: new Set() });

/** The emails a person gets walking a tree with these facts, waits taken at once. */
function emails(steps: Parameters<typeof advance>[0], f: FlowFacts): string[] {
  const out: string[] = [];
  let path: FlowPath | null = ["0"];
  for (let i = 0; i < 50; i++) {
    const move = advance(steps, [], path, f);
    if (move.do === "end") break;
    if (move.do === "email") out.push(move.step.id);
    path = move.next;
  }
  return out;
}

describe("the goals a flow starts from (D767 slice 3, M3.1)", () => {
  it("makes every recipe a sound flow in Norwegian and English, naming the automation it replaces (the sunset replaces none)", () => {
    for (const [key, recipe] of Object.entries(RECIPES)) {
      for (const locale of ["nb-NO", "en-GB"]) {
        const flow = recipe(locale);
        expect(flowInputSchema.safeParse(flow).success, key).toBe(true);
        expect(checkFlow(flow.steps), key).toEqual([]);
        expect(flow.replaces).toBe(key === "sunset" ? null : key);
      }
    }
  });

  it("follows up a purchase a week later, and sends something new only to someone who has not ordered again", () => {
    const steps = RECIPES.after_purchase("en-GB").steps;
    expect(emails(steps, facts(false))).toEqual(["how", "again"]);
    expect(emails(steps, facts(true))).toEqual(["how"]);
    expect(RECIPES.after_purchase("nb-NO").name).toBe("Etter et kjøp");
  });
});

describe("a goal's flow from the owner's own automation (slice 3, M2.2)", () => {
  it("keeps the owner's words and days, follow-ups after their days, ended by an order", async () => {
    const { flowFromAutomation } = await import("./flow-recipes");
    const words = (subject: string) => ({ "nb-NO": { subject, preview: "", blocks: [{ type: "paragraph" as const, text: subject }] } });
    const flow = flowFromAutomation("after_purchase", { delayDays: 7, content: words("Hvordan går det?"), followUps: [{ position: 2, delayDays: 14, content: words("Noe nytt") }] }, "nb-NO");
    expect(flow).toMatchObject({ name: "Etter et kjøp", trigger: "order.paid", replaces: "after_purchase", goals: [{ kind: "ordered" }] });
    expect(flow?.steps.map((s) => (s.kind === "wait" ? `wait ${s.hours}` : s.id))).toEqual(["wait 168", "email-1", "wait 336", "email-2"]);
    expect(flow && checkFlow(flow.steps)).toEqual([]);
    // A welcome the same day has no wait first, and no goal without follow-ups.
    const welcome = flowFromAutomation("welcome", { delayDays: 0, content: words("Velkommen"), followUps: [] }, "nb-NO");
    expect(welcome?.steps.map((s) => s.id)).toEqual(["email-1"]);
    expect(welcome?.goals).toEqual([]);
    expect(flowFromAutomation("welcome", { delayDays: 0, content: null, followUps: [] }, "nb-NO")).toBeNull();
  });
});

describe("win-back from the owner's own automation (slice 4)", () => {
  it("makes its days the lapse, sends the first email at once, and ends at an order", async () => {
    const { flowFromAutomation } = await import("./flow-recipes");
    const words = { "en-GB": { subject: "Come back", preview: "", blocks: [{ type: "paragraph" as const, text: "We miss you" }] } };
    const flow = flowFromAutomation("win_back", { delayDays: 120, content: words, followUps: [] }, "en-GB");
    expect(flow).toMatchObject({ trigger: "customer.lapsed", triggerDays: 120, replaces: "win_back", goals: [{ kind: "ordered" }] });
    expect(flow?.steps.map((s) => s.id)).toEqual(["email-1"]);
    expect(flowInputSchema.safeParse(flow).success).toBe(true);
  });
});

describe("a flow of the owner's own (slice 4)", () => {
  it("is one sound email when an order is sent, replacing nothing", async () => {
    const { ownFlow } = await import("./flow-recipes");
    const flow = ownFlow("nb-NO");
    expect(flowInputSchema.safeParse(flow).success).toBe(true);
    expect(checkFlow(flow.steps)).toEqual([]);
    expect(flow).toMatchObject({ name: "Mitt forløp", trigger: "order.sent", replaces: null });
  });
});

describe("keep your list awake, the sunset (M2.8)", () => {
  it("asks once after 180 days with no press, waits 14 days, and replaces no automation", () => {
    const flow = sunset("en-GB");
    expect(flowInputSchema.safeParse(flow).success).toBe(true);
    expect(flow).toMatchObject({ trigger: "subscriber.asleep", triggerDays: 180, replaces: null });
    expect(flow.steps.map((s) => s.kind)).toEqual(["email", "wait"]);
    expect(flow.steps[1]).toMatchObject({ hours: 336 });
    expect(sunset("nb-NO").name).toBe("Hold listen våken");
  });

  it("counts as made when a flow has its trigger, as the others do by the automation they replace", () => {
    expect([...goalsMade([{ replaces: "welcome", trigger: "subscriber.subscribed" }, { replaces: null, trigger: "subscriber.asleep" }])].sort()).toEqual(["sunset", "welcome"]);
    expect(goalsMade([{ replaces: null, trigger: "order.sent" }]).size).toBe(0);
  });
});

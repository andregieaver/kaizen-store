import type { FlowCondition, FlowStep } from "./flows";
import type { FLOW_TRIGGERS } from "./flow-triggers";

type FlowTrigger = (typeof FLOW_TRIGGERS)[number];

/**
 * Who a flow's email reaches and when, for the store's writer (email plan M3.7, the broadcast writer `suggestBroadcast()`'s `audience`, as
 * the automations' AUTOMATION_AUDIENCE): what starts the flow, which of its emails this is, how long after the start, on which branch, and
 * what the writer may not know of the reader. English for the model; never shown to a person. Pure.
 */

const STARTS: Record<FlowTrigger, (days: number | null) => string> = {
  "subscriber.subscribed": () => "It goes to each person who joins the shop's list.",
  "order.paid": () => "It goes to each customer on the shop's list after their order is paid. You do not know what they bought, so never name it.",
  "checkout.abandoned": () => "It goes to each person on the shop's list who started a checkout and left it. You do not know what was in it, so never name it; remind them kindly, without pressure.",
  "order.sent": () => "It goes to each customer on the shop's list after their order is sent. You do not know what they bought, so never name it.",
  "subscription.started": () => "It goes to each customer on the shop's list who starts a subscription. Thank them and say what comes next, without naming what they subscribe to.",
  "subscription.cancelled": () => "It goes to each customer on the shop's list who ends a subscription. Thank them, without pressure to come back.",
  "form.response": () => "It goes to each person on the shop's list who answered one of its forms. You do not know what they wrote, so never quote it.",
  "quote.requested": () => "It goes to each person on the shop's list who asked for a quote. You do not know what they asked for, so never name it; say the shop will answer.",
  "review.created": () => "It goes to each customer on the shop's list who wrote a review. Thank them; you do not know what they wrote, so never quote it.",
  "customer.lapsed": (d) => `It goes to customers on the shop's list who have not ordered for ${d ?? 90} days. Invite them back warmly, without pressure.`,
  "customer.browsed": (d) =>
    `It goes to signed-in customers on the shop's list ${d ?? 1} ${d === 1 ? "day" : "days"} after they last looked at products they did not buy. Never say you watched them.`,
};

const CONDITIONS: Record<FlowCondition["kind"], [string, string]> = {
  ordered_since_entry: ["who have ordered since the flow started for them", "who have not ordered since the flow started for them"],
  clicked_flow_email: ["who pressed a link in one of its emails", "who have not pressed a link in its emails"],
  in_segment: ["in one of the shop's groups of customers", "outside one of the shop's groups of customers"],
};

type Place = { index: number; hours: number; branch: string | null };

/** Where an email sits: its place among the emails read in order, the hours waited before it on its path, and its branch's words. */
function placeOf(steps: readonly FlowStep[], id: string): Place | null {
  let index = 0;
  const walk = (list: readonly FlowStep[], hours: number, branch: string | null): Place | null => {
    let waited = hours;
    for (const step of list) {
      if (step.kind === "wait") waited += step.hours;
      if (step.kind === "email") {
        index += 1;
        if (step.id === id) return { index, hours: waited, branch };
      }
      if (step.kind === "if") {
        const [yes, no] = CONDITIONS[step.condition.kind];
        const found = walk(step.then, waited, yes) ?? walk(step.else, waited, no);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(steps, 0, null);
}

function after(hours: number): string {
  if (hours === 0) return "as soon as the flow starts for them";
  if (hours % 24 === 0) return `${hours / 24} ${hours === 24 ? "day" : "days"} after the flow starts for them`;
  return `${hours} ${hours === 1 ? "hour" : "hours"} after the flow starts for them`;
}

export function flowAudience(steps: readonly FlowStep[], id: string, trigger: string, triggerDays: number | null): string {
  const place = placeOf(steps, id);
  const step = findEmail(steps, id);
  const starts = STARTS[trigger as FlowTrigger];
  const parts = starts ? [starts(triggerDays)] : [];
  if (place) {
    parts.push(
      `This is email ${place.index} of the flow, sent ${after(place.hours)}${place.branch ? `, only to those ${place.branch}` : ""}.`,
      ...(place.index > 1 ? ["Earlier emails already greeted them: never repeat a welcome or copy an earlier email."] : []),
    );
  }
  if (step?.picks) {
    parts.push("The shop shows each reader a few products chosen for them under your words. You do not know which, so never name them, and choose no products yourself.");
  }
  return parts.join(" ");
}

function findEmail(steps: readonly FlowStep[], id: string): Extract<FlowStep, { kind: "email" }> | null {
  for (const step of steps) {
    if (step.kind === "email" && step.id === id) return step;
    if (step.kind === "if") {
      const found = findEmail(step.then, id) ?? findEmail(step.else, id);
      if (found) return found;
    }
  }
  return null;
}

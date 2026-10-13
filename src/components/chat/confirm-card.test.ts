import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConfirmCard, actionLine, type ActionLabels } from "./confirm-card";

const labels: ActionLabels = {
  confirm: "Confirm",
  noThanks: "No thanks",
  expired: "This suggestion has expired.",
  done: "Done: {summary}",
  failed: "It could not be done: {reason}",
  declined: "You said no thanks.",
  requested: "Passed to a person: {summary}",
  decidedDone: "The store has dealt with it: {summary}",
  decidedDeclined: "The store could not: {summary}",
  note: "From the store: {note}",
  why: { closed: "Too late.", failed: "Something went wrong." },
};

const card = (status: "proposed" | "expired" | "done", confirmer: "customer" | "staff" = "customer", open = true) =>
  renderToString(
    createElement(ConfirmCard, {
      action: { id: "a", summary: "Cancel the haircut.", status, confirmer },
      open,
      labels,
      sorry: "Sorry",
      site: { store: "s", market: "no" },
      conversation: { id: "c", token: "t" },
      after: 0,
      onReply: () => {},
    }),
  );

describe("the confirm card (D216, step 10)", () => {
  it("offers Confirm and No thanks only while a proposal is open", () => {
    expect(card("proposed")).toContain("Confirm");
    expect(card("proposed")).toContain("No thanks");
    expect(card("proposed")).toContain("Cancel the haircut.");
    expect(card("proposed", "customer", false)).not.toContain("No thanks");
    expect(card("done")).not.toContain("Confirm");
    expect(card("expired")).toContain("This suggestion has expired.");
  });

  it("shows a staff request as passed on, with nothing to press", () => {
    const html = card("proposed", "staff");
    expect(html).toContain("Passed to a person: Cancel the haircut.");
    expect(html).not.toContain("<button");
  });

  it("words the lines after it from the site's labels, never the model", () => {
    expect(actionLine("action_done", { summary: "X." }, labels)).toBe("Done: X.");
    expect(actionLine("action_failed", { why: "closed" }, labels)).toBe("It could not be done: Too late.");
    expect(actionLine("action_failed", { why: "unknown" }, labels)).toBe("It could not be done: Something went wrong.");
    expect(actionLine("request_done", { summary: "A refund.", note: "Paid back." }, labels)).toBe("The store has dealt with it: A refund. From the store: Paid back.");
    expect(actionLine("request_declined", { summary: "A refund." }, labels)).toBe("The store could not: A refund.");
    expect(actionLine("joined", {}, labels)).toBeNull();
  });
});

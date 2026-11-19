import { describe, expect, it } from "vitest";

import { flowChecks } from "./flow-checks";
import type { FlowStep } from "./flows";

const words = (subject: string, blocks: Extract<FlowStep, { kind: "email" }>["content"][string]["blocks"]) => ({ subject, preview: "", blocks });
const p = (text: string) => ({ type: "paragraph" as const, text });

describe("checks before a flow is switched on (D767, M3.6)", () => {
  it("passes a sound flow", () => {
    const steps: FlowStep[] = [{ id: "a", kind: "email", content: { "nb-NO": words("Hei", [p("Hei")]), "en-GB": words("Hi", [p("Hi")]) } }];
    expect(flowChecks(steps, "nb-NO")).toEqual([]);
  });

  it("blocks an email not written in the first language, or a language half written, inside a branch too", () => {
    const steps: FlowStep[] = [
      { id: "a", kind: "email", content: { "en-GB": words("Hi", [p("Hi")]) } },
      {
        id: "q",
        kind: "if",
        condition: { kind: "ordered_since_entry" },
        then: [{ id: "b", kind: "email", content: { "nb-NO": words("Hei", [p("Hei")]), "sv-SE": words("Hej", []) } }],
        else: [],
      },
    ];
    expect(flowChecks(steps, "nb-NO")).toEqual([
      { stepId: "a", subject: "Hi", kind: "main_missing", locale: "nb-NO", blocking: true },
      { stepId: "b", subject: "Hei", kind: "half_written", locale: "sv-SE", blocking: true },
    ]);
  });

  it("warns of a picture without a description or in a format mail apps do not show, and of an email near Gmail's clipping", () => {
    const steps: FlowStep[] = [
      {
        id: "a",
        kind: "email",
        content: {
          "nb-NO": words("Hei", [
            { type: "image", url: "https://example.com/a.webp", alt: "", href: null },
            p("x".repeat(9000)),
            p("y".repeat(9000)),
            p("z".repeat(9000)),
          ]),
        },
      },
    ];
    expect(flowChecks(steps, "nb-NO").map((c) => [c.kind, c.blocking])).toEqual([
      ["picture_alt", false],
      ["picture_format", false],
      ["too_big", false],
    ]);
  });
});

describe("a broadcast's words (M3.6)", () => {
  it("are checked as a flow email's are", async () => {
    const { contentChecks } = await import("./flow-checks");
    const content = { "nb-NO": words("Hei", [{ type: "image" as const, url: "https://example.com/a.png", alt: "", href: null }]) };
    expect(contentChecks(content, "nb-NO")).toEqual([{ kind: "picture_alt", locale: "nb-NO", blocking: false }]);
  });
});

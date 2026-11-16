import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { heatmapsEn } from "@/lib/admin-messages/heatmaps.en";

import { SignalsSection } from "./settings-forms";

/** The owner's heatmaps switch on Analytics → Settings (D656 step 5): what it says off and on, and the one button that changes it. */

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");
const action = async () => ({ status: "ok" as const, messages: [] });

describe("the heatmaps switch (D656)", () => {
  it("off: says nothing is measured, what would be and what never is, and offers to switch them on", () => {
    const markup = html(h(SignalsSection, { heatmaps: false, action }));
    expect(markup).toContain('id="signals"');
    expect(markup).toContain(heatmapsEn.stateOff);
    for (const line of [...heatmapsEn.what, ...heatmapsEn.not]) expect(markup).toContain(line);
    expect(markup).toContain(heatmapsEn.askAgain);
    expect(markup).toMatch(/<button[^>]*value="on"[^>]*name="enabled"/);
    expect(markup).toContain(heatmapsEn.turnOn);
    expect(markup).not.toContain(heatmapsEn.turnOff);
  });

  it("on: says visitors who allow statistics are measured, and offers to switch them off", () => {
    const markup = html(h(SignalsSection, { heatmaps: true, action }));
    expect(markup).toContain(heatmapsEn.stateOn);
    expect(markup).toMatch(/<button[^>]*value="off"[^>]*name="enabled"/);
    expect(markup).toContain(heatmapsEn.turnOff);
  });

  it("draws no button for a member who may not change it", () => {
    expect(html(h(SignalsSection, { heatmaps: false, action: null }))).not.toContain("<button");
  });
});

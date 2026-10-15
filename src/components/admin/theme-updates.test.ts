import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FormState } from "./action-form";
import { ThemeUpdates, type ThemeFollowing, type UpdateMade, type UpdateWaiting } from "./theme-updates";

/** Theme updates (D245): what waits with What's new, how each theme is updated, and the latest updates with Undo. */
const act = async (state: FormState) => state;
const waiting: UpdateWaiting = { installId: "i1", title: "Calm", live: true, from: 1, to: 2, followsUpdates: true, whatsNew: ["Calmer colours.", "New fonts."] };
const made: UpdateMade = { id: "u1", title: "Calm", from: 1, to: 2, at: "2026-10-15T10:00:00Z", automatic: true, own: 2, keptSettings: 1, layoutsKept: ["footer"], undoneAt: null };
const following: ThemeFollowing = { installId: "i1", title: "Calm", live: true, version: 2, followsUpdates: true };
const draw = (props: Partial<Parameters<typeof ThemeUpdates>[0]>) =>
  renderToStaticMarkup(
    createElement(ThemeUpdates, { available: [], made: [], installs: [], keepDays: 90, update: act, undo: act, follow: act, ...props }),
  ).replaceAll("<!-- -->", "");

describe("Theme updates (D245)", () => {
  it("draws nothing when no installed theme can be updated", () => {
    expect(draw({})).toBe("");
  });

  it("shows a waiting update with What's new and Update now", () => {
    const html = draw({ available: [waiting], installs: [following] });
    expect(html).toContain("Calm: version 1 → version 2");
    expect(html).toContain("Calmer colours.");
    expect(html).toContain("Update now");
    expect(html).toContain("It will update by itself");
    expect(html).toContain("Let me update it");
  });

  it("says when the makers named nothing new", () => {
    expect(draw({ available: [{ ...waiting, whatsNew: [], followsUpdates: false }] })).toContain("did not say what is new");
  });

  it("lists the latest updates with what was kept, and Undo only until undone", () => {
    const html = draw({ made: [made] });
    expect(html).toContain("2026-10-15, by itself");
    expect(html).toContain("2 of your own settings kept");
    expect(html).toContain("your footer kept");
    expect(html).toContain("Undo");
    const undone = draw({ made: [{ ...made, undoneAt: "2026-10-16T08:00:00Z" }] });
    expect(undone).toContain("Undone 2026-10-16");
    expect(undone).not.toContain("Undo<");
  });

  it("offers no buttons to someone who may only look", () => {
    const html = draw({ available: [waiting], made: [made], installs: [following], update: null, undo: null, follow: null });
    expect(html).not.toContain("Update now");
    expect(html).not.toContain("Let me update it");
    expect(html).not.toContain("<button");
  });
});

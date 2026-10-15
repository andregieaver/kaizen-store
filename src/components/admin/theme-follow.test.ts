import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThemeFollow, type FollowRun } from "./theme-follow";

/** *Let pages follow the theme* (D243): the two presses, the latest runs with Undo until undone, nothing to press for a reader. */
const DONE: FollowRun = { runId: "11111111-1111-4111-8111-111111111111", at: "2026-10-15T10:00:00.000Z", pages: 3, followed: 12, kept: 1, undoneAt: null };
const UNDONE: FollowRun = { runId: "22222222-2222-4222-8222-222222222222", at: "2026-10-14T10:00:00.000Z", pages: 1, followed: 1, kept: 0, undoneAt: "2026-10-14T11:00:00.000Z" };
const act = async () => ({ status: "ok" as const, messages: [] });
const draw = (props: Partial<Parameters<typeof ThemeFollow>[0]> = {}) =>
  renderToStaticMarkup(createElement(ThemeFollow, { runs: [DONE, UNDONE], keepDays: 90, count: act, run: act, undo: act, ...props })).replaceAll("<!-- -->", "");

describe("letting pages follow the theme (D243)", () => {
  it("offers the count and the run, and Undo for a run not undone", () => {
    const html = draw();
    expect(html).toContain("Count the settings");
    expect(html).toContain("Make pages follow the theme");
    expect(html).toContain("12 settings on 3 pages");
    expect(html).toContain("1 setting kept as your own");
    expect(html).toContain(`name="run" value="${DONE.runId}"`);
    expect(html).not.toContain(`name="run" value="${UNDONE.runId}"`);
    expect(html).toContain("Undone 2026-10-14");
    expect(html).toContain("Words, pictures, videos and links are never touched");
    expect(html).toContain("for 90 days");
  });

  it("offers nothing to press to someone who may only look", () => {
    const html = draw({ count: null, run: null, undo: null });
    expect(html).not.toContain("Count the settings");
    expect(html).not.toContain(`name="run"`);
    expect(html).toContain("12 settings on 3 pages");
  });
});

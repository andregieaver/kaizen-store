import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LeaveDialog, RestoreBar } from "./leave-dialogs";

/**
 * What the leave guard asks and what a kept draft offers (code review 1.16, D787), as drawn: the admin's own dialog with Keep editing as
 * its main choice, and the bar that offers the changes kept in this browser with when they were made.
 */

const html = (node: Parameters<typeof renderToString>[0]) => renderToString(node).replace(/<!-- -->/g, "");
const noop = () => {};

describe("the leave guard's dialog", () => {
  it("asks Leave without saving? in a named dialog, Keep editing the main choice and last", () => {
    const out = html(createElement(LeaveDialog, { onStay: noop, onLeave: noop }));
    expect(out).toContain("<dialog");
    expect(out).toContain("aria-labelledby=");
    expect(out).toContain(">Leave without saving?<");
    expect(out).toContain("Your changes are not saved yet. If you leave now, they are lost.");
    expect(out).toMatch(/data-leave-confirm=""[^>]*>Leave without saving</);
    expect(out).toMatch(/bg-brand[^"]*"[^>]*data-leave-stay=""[^>]*>Keep editing</);
    expect(out.indexOf(">Leave without saving<")).toBeLessThan(out.indexOf(">Keep editing<"));
  });
});

describe("the offer of changes kept in this browser", () => {
  it("says when they were made and offers Restore unsaved changes, or Discard", () => {
    const out = html(createElement(RestoreBar, { at: Date.UTC(2026, 10, 19, 9, 5), onRestore: noop, onDiscard: noop }));
    expect(out).toContain('role="status"');
    expect(out).toMatch(/Changes from 19 Nov,? 09:05 were not saved\. They are kept in this browser\./);
    expect(out).toContain(">Restore unsaved changes<");
    expect(out).toContain(">Discard<");
  });
});

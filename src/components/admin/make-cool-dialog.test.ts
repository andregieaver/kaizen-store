import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MAKE_COOL_LABEL, MAKE_COOL_TEXT, MakeCoolBody, MakeCoolButtons, MakeCoolDialog } from "./make-cool-dialog";

/**
 * "Make my page cool" as it is drawn before any script runs (D128): what a person sees in each phase, and that the
 * buttons and the status are marked for keyboards and screen readers.
 */

const html = (node: Parameters<typeof renderToString>[0]) => renderToString(node).replace(/<!-- -->/g, "");
const noop = () => {};

describe("the Make my page cool dialog", () => {
  it("names itself and asks nothing but Cancel or Go", () => {
    expect(MAKE_COOL_LABEL).toBe("Make my page cool");
    const out = html(
      createElement(MakeCoolDialog, {
        open: true,
        onClose: noop,
        run: async () => ({ ok: false as const, problem: "x" }),
        onApply: noop,
      }),
    );
    expect(out).toContain("<dialog");
    expect(out).toContain("aria-labelledby=");
    expect(out).toContain(MAKE_COOL_LABEL);
    expect(out).toContain("tasteful motion");
    expect(out).toContain("Nothing you already animated is changed.");
    expect(out).toContain(">Cancel<");
    expect(out).toContain(">Go<");
    expect(out).not.toMatch(/ disabled=""/);
    expect(out).not.toContain("aria-busy");
    expect(out).not.toContain("Looking at your page");
  });

  it("draws nothing inside while closed", () => {
    const out = html(
      createElement(MakeCoolDialog, {
        open: false,
        onClose: noop,
        run: async () => ({ ok: false as const, problem: "x" }),
        onApply: noop,
      }),
    );
    expect(out).not.toContain(MAKE_COOL_TEXT);
  });

  it("says it is working, in words, with the buttons off and the region busy", () => {
    const body = html(createElement(MakeCoolBody, { phase: { name: "running" } }));
    expect(body).toContain("Looking at your page…");
    expect(body).toContain('aria-busy="true"');
    expect(body).toContain('role="status"');
    // A bar that pulses only where motion is welcome, and is hidden from screen readers (the words carry it).
    expect(body).toContain("motion-safe:animate-pulse");
    expect(body).not.toMatch(/(?<!motion-safe:)animate-pulse/);
    const buttons = html(createElement(MakeCoolButtons, { phase: { name: "running" }, onCancel: noop, onGo: noop }));
    expect(buttons.match(/ disabled=""/g)).toHaveLength(2);
  });

  it("says what went wrong, and offers to try again", () => {
    const phase = { name: "error", problem: "The AI could not look at your page." } as const;
    const body = html(createElement(MakeCoolBody, { phase }));
    expect(body).toContain("The AI could not look at your page.");
    expect(body).toContain('role="alert"');
    const buttons = html(createElement(MakeCoolButtons, { phase, onCancel: noop, onGo: noop }));
    expect(buttons).toContain(">Try again<");
    expect(buttons).toContain(">Cancel<");
    expect(buttons).not.toContain(">Go<");
    expect(buttons).not.toMatch(/ disabled=""/);
  });

  it("writes a problem as text, never as markup", () => {
    const body = html(
      createElement(MakeCoolBody, { phase: { name: "error", problem: "<img src=x onerror=alert(1)>" } }),
    );
    expect(body).not.toContain("<img");
    expect(body).toContain("&lt;img");
  });
});

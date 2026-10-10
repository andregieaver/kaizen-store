import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InlineHeadingEditor } from "./heading-editor";

/**
 * The heading edited where it stands (D191): its own element at its level, in the classes the page gives it, a text box for a screen
 * reader. Its words and caret are put in by the browser as it mounts (the interaction is held in a real browser).
 */

const render = (level: number) =>
  renderToString(
    createElement(InlineHeadingEditor, {
      level,
      className: "leading-tight text-balance font-heading",
      text: "Hello",
      point: null,
      onChange: () => {},
      onDone: () => {},
    }),
  );

describe("a heading edited in place", () => {
  it("is the heading's element at its level, with the page's classes", () => {
    for (const level of [1, 2, 3, 4, 5, 6]) expect(render(level)).toMatch(new RegExp(`^<h${level} [^>]*class="leading-tight text-balance font-heading `));
  });

  it("is a one-line text box named for what it is", () => {
    const out = render(2);
    expect(out).toContain('role="textbox"');
    expect(out).toContain('aria-label="Heading text"');
    expect(out).toContain('aria-multiline="false"');
    expect(out).toContain('data-inline-editing="heading"');
  });

  it("takes a level only from 1 to 6", () => {
    expect(render(9)).toMatch(/^<h6 /);
    expect(render(0)).toMatch(/^<h1 /);
  });
});

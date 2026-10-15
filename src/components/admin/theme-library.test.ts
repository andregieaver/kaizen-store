import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThemeLibrary, type LibraryInstall } from "./theme-library";

/** The store's theme library (D241): the live theme marked, the others with Switch to and Remove, nothing to press for a reader. */
const LIVE: LibraryInstall = { id: "a", title: "Nordic calm", version: 2, live: true, installedAt: "2026-10-15T10:00:00.000Z", switchedAt: "2026-10-15T10:00:00.000Z" };
const KEPT: LibraryInstall = { id: "b", title: "Custom", version: null, live: false, installedAt: "2026-01-02T10:00:00.000Z", switchedAt: "2026-10-15T10:00:00.000Z" };
const act = async () => ({ status: "ok" as const, messages: [] });
const draw = (props: Partial<Parameters<typeof ThemeLibrary>[0]> = {}) =>
  renderToStaticMarkup(createElement(ThemeLibrary, { installs: [LIVE, KEPT], switchTo: act, remove: act, ...props })).replaceAll("<!-- -->", "");

describe("the theme library (D241)", () => {
  it("marks the live theme and offers the others to switch to or remove, with the removal confirmed first", () => {
    const html = draw();
    expect(html).toContain("Version 2");
    expect(html).toContain(">Live<");
    expect(html).toContain('name="install" value="b"');
    expect(html).not.toContain('name="install" value="a"');
    expect(html).toContain("Switch to");
    expect(html).toContain("<details");
    expect(html).toContain("never touches your products, pages, words, pictures, videos, menus, logo or business details");
  });

  it("offers nothing to press to someone who may only look", () => {
    const html = draw({ switchTo: null, remove: null });
    expect(html).not.toContain("Switch to");
    expect(html).not.toContain("Remove");
    expect(html).toContain("Custom");
  });

  it("links each theme to its page and the live one to its preview (D244)", () => {
    const html = draw({ base: "/admin/shop/settings/design" });
    expect(html).toContain('href="/admin/shop/settings/design/themes/b"');
    expect(html).toContain("Customise");
    expect(html).toContain('href="/admin/shop/settings/design/themes/a/preview"');
    // Someone who may only look opens it rather than customising it.
    expect(draw({ base: "/admin/shop/settings/design", switchTo: null, remove: null })).toContain("Open");
  });
});


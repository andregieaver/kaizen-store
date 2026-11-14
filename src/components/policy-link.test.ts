import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: (props: Record<string, unknown> & { children?: unknown }) => {
    const { prefetch, onPointerEnter, onTouchStart, onFocus, children, ...attrs } = props;
    void onPointerEnter;
    void onTouchStart;
    void onFocus;
    return h("a", { ...attrs, "data-prefetch": String(prefetch) }, children as never);
  },
}));

import { AdminLink } from "./admin/ui/link";
import { PolicyLink } from "./policy-link";

/** The three policies of PolicyLink (bloat review step 0.13): what each hands next/link before any event, and that no attribute is lost. */
describe("PolicyLink", () => {
  it("view hands Next's default (null)", () => {
    expect(renderToStaticMarkup(h(PolicyLink, { policy: "view", href: "/a" }, "A"))).toContain('data-prefetch="null"');
  });
  it("intent is false until the link is asked", () => {
    expect(renderToStaticMarkup(h(PolicyLink, { policy: "intent", href: "/a" }, "A"))).toContain('data-prefetch="false"');
  });
  it("none is false", () => {
    expect(renderToStaticMarkup(h(PolicyLink, { policy: "none", href: "/a" }, "A"))).toContain('data-prefetch="false"');
  });
  it("keeps every attribute and the children", () => {
    const markup = renderToStaticMarkup(h(PolicyLink, { policy: "intent", href: "/a", "aria-current": "page", role: "menuitem", className: "x" }, "Label"));
    expect(markup).toContain('href="/a"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('role="menuitem"');
    expect(markup).toContain('class="x"');
    expect(markup).toContain(">Label<");
  });
});

describe("AdminLink", () => {
  it("is intent by default, so false before any event", () => {
    expect(renderToStaticMarkup(h(AdminLink, { href: "/a" }, "A"))).toContain('data-prefetch="false"');
  });
  it("treats prefetch={false} as none", () => {
    expect(renderToStaticMarkup(h(AdminLink, { href: "/a", prefetch: false }, "A"))).toContain('data-prefetch="false"');
  });
  it("passes a view policy through", () => {
    expect(renderToStaticMarkup(h(AdminLink, { href: "/a", policy: "view" }, "A"))).toContain('data-prefetch="null"');
  });
});

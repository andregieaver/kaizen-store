import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ADMIN_SCHEMES } from "@/lib/admin-schemes";

import { SchemePreview } from "./scheme-preview";

/** The Appearance page's sample of a scheme (D222): coloured by its own mark, a picture nothing in can be pressed, named in words. */
describe("a scheme's preview", () => {
  it.each(ADMIN_SCHEMES.flatMap((scheme) => (["light", "dark"] as const).map((mode) => [scheme.id, mode, scheme] as const)))("%s in %s", (id, mode, scheme) => {
    const out = renderToStaticMarkup(h(SchemePreview, { scheme, mode }));
    expect(out).toContain(`data-scheme-preview="${id}"`);
    expect(out).toContain(`data-preview-mode="${mode}"`);
    expect(out).toContain(`color-scheme:${mode}`);
    expect(out).toMatch(/<div inert=""/);
    expect(out).toContain(`<figcaption class="text-sm text-muted">${scheme.name}, ${mode}</figcaption>`);
    // A sample's title is not a second main heading of the page.
    expect(out).not.toContain("<h1");
    // Every kind of component is in it.
    for (const piece of ["bg-brand text-brand-ink", "bg-inverse text-inverse-ink", "border-edge bg-card", "bg-danger-soft", "rounded-card bg-card", "text-metric", "bg-insight-soft", "divide-line", "bg-rail", "<input"]) {
      expect(out, piece).toContain(piece);
    }
  });
});

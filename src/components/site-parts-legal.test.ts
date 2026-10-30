import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { SitePartView } = await import("./site-parts");

/** Kaizena Flow's footer reaches its terms, privacy notice and data processing agreement once they are published (D408). */
describe("Kaizena Flow's legal pages in its footer", () => {
  const chrome = (slugs: string[]) =>
    ({
      pages: new Map(slugs.map((slug) => [slug, { id: slug, slug, title: `Title ${slug}`, titles: { "nb-NO": `Tittel ${slug}` } }])),
    }) as never;
  const view = (slugs: string[], lang?: "en" | "nb") =>
    renderToString(createElement(SitePartView, { block: { id: "b", type: "site", part: "cookies" } as never, ctx: { kind: "kaizen", chrome: chrome(slugs), place: "footer", lang } }));

  it("links each published one beside the cookies, in its own language", () => {
    const html = view(["privacy", "terms", "data-processing-agreement", "about"]);
    expect(html.indexOf('href="/terms"')).toBeLessThan(html.indexOf('href="/privacy"'));
    expect(html.indexOf('href="/privacy"')).toBeLessThan(html.indexOf('href="/data-processing-agreement"'));
    expect(html).toContain('href="/cookies"');
    expect(html).not.toContain('href="/about"');
    expect(view(["terms"], "nb")).toContain("Tittel terms");
  });

  it("shows only the cookies while none is published", () => {
    const html = view([]);
    expect(html).toContain('href="/cookies"');
    expect(html).not.toContain("/terms");
  });
});

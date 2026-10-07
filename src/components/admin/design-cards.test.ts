import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { keepDesignCard, type DesignCard } from "@/lib/design-presets";

import { DesignCards } from "./design-cards";
import { DesignProfilePanel } from "./design-profile-panel";

const calm: DesignCard = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  title: "Nordic calm",
  summary: "Pale wood, deep green, Lora headings.",
  description: "A quiet look.\nGood for spas.",
  pictureUrl: "/storage/calm.webp",
  previewHref: "/admin/account/design-profiles/0f8fad5b-d9cb-469f-a165-70867728950e/preview",
};

const checked = (html: string, value: string) => {
  const input = (html.match(/<input[^>]*>/g) ?? []).find((tag) => tag.includes(`value="${value}"`));
  return Boolean(input?.includes('checked=""'));
};
const links = (html: string) => html.match(/<a [^>]*>/g) ?? [];

describe("the design profile cards (D176)", () => {
  it("offers keeping the template's own design first and chosen, then each profile with its picture and summary", () => {
    const html = renderToString(createElement(DesignCards, { cards: [keepDesignCard(), calm] }));
    expect(html.indexOf("Keep the template&#x27;s own design")).toBeLessThan(html.indexOf("Nordic calm"));
    expect(checked(html, "")).toBe(true);
    expect(checked(html, calm.id)).toBe(false);
    expect(html).toContain('src="/storage/calm.webp"');
    expect(html).toContain("More about it");
  });

  it("chooses the recommended profile when told to, and falls back to keeping the look for an unknown one", () => {
    expect(checked(renderToString(createElement(DesignCards, { cards: [keepDesignCard(), calm], selected: calm.id })), calm.id)).toBe(true);
    expect(checked(renderToString(createElement(DesignCards, { cards: [keepDesignCard(), calm], selected: "nope" })), "")).toBe(true);
  });

  it("opens each preview in a new window without giving it this page, and has none for keeping the look", () => {
    const html = renderToString(createElement(DesignCards, { cards: [keepDesignCard(), calm], recommended: {} }));
    expect(links(html)).toHaveLength(1);
    const [link] = links(html);
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener"');
    expect(link).toContain(`href="${calm.previewHref}"`);
    expect(html).toContain("(opens in a new window)");
  });
});

describe("the design profiles on a store's Design settings (D176)", () => {
  const draw = (props: Partial<Parameters<typeof DesignProfilePanel>[0]> = {}) =>
    // Without React's text markers, so sentences read as they show.
    renderToString(
      createElement(DesignProfilePanel, {
        designs: [{ ...calm, previewHref: calm.previewHref! }],
        latest: null,
        apply: async () => ({ status: "ok" as const, messages: [] }),
        restore: async () => ({ status: "ok" as const, messages: [] }),
        canChange: true,
        ...props,
      }),
    ).replaceAll("<!-- -->", "");

  it("says exactly what applying changes and that the look from before is kept, before the Apply button", () => {
    const html = draw();
    expect(html).toContain("<details");
    expect(html).toContain("replaces the theme");
    expect(html).toContain("keeps your products, pages, menus, logo, name and business details as they are");
    expect(html).toContain("Before Nordic calm");
    expect(html).toContain("Apply Nordic calm");
    expect(html).toContain(`name="design" value="${calm.id}"`);
    for (const link of links(html)) {
      expect(link).toContain('target="_blank"');
      expect(link).toContain('rel="noopener"');
    }
  });

  it("offers the way back after a profile was applied, and nothing to press for someone who may not change the website", () => {
    const html = draw({ latest: { presetTitle: "Nordic calm", appliedAt: "2026-10-07T10:00:00.000Z", savedTheme: "Before Nordic calm (2026-10-07)" } });
    expect(html).toContain("Put back the look from before Nordic calm");
    const reader = draw({ canChange: false, apply: null, restore: null, latest: { presetTitle: "Nordic calm", appliedAt: "2026-10-07T10:00:00.000Z", savedTheme: null } });
    expect(reader).not.toContain("Apply Nordic calm");
    expect(reader).not.toContain("Put back");
    expect(reader).toContain("Preview");
  });
});

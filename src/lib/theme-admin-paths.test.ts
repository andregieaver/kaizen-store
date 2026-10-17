// @ts-expect-error Next bundles path-to-regexp, the router's own matcher, without types.
import { compile, match } from "next/dist/compiled/path-to-regexp";
import { describe, expect, it } from "vitest";

import { LEGACY_THEME_REDIRECTS, SITE_DESIGN, THEMES_ADMIN, demoStoreHref } from "./theme-admin-paths";

/** Where Next would send an address: the first redirect whose source matches, else null. */
function redirected(pathname: string): string | null {
  for (const rule of LEGACY_THEME_REDIRECTS) {
    const found = match(rule.source)(pathname);
    if (found) return compile(rule.destination)(found.params as Record<string, string | string[]>);
  }
  return null;
}

const id = "0b6f3c1e-8a2d-4f5b-9c7e-1d2a3b4c5d6e";

describe("themes' addresses in the platform's admin (D273)", () => {
  it("builds the Themes page, a demo store's and the site's Design", () => {
    expect(THEMES_ADMIN).toBe("/admin/platform/themes");
    expect(SITE_DESIGN).toBe("/admin/platform/site-design");
    expect(demoStoreHref(id)).toBe(`/admin/platform/themes/demo-stores/${id}`);
  });

  it("sends design profiles' and store templates' old addresses to the Themes page", () => {
    expect(redirected("/admin/platform/design-profiles")).toBe(THEMES_ADMIN);
    expect(redirected(`/admin/platform/design-profiles/${id}`)).toBe(`${THEMES_ADMIN}/${id}`);
    expect(redirected(`/admin/platform/design-profiles/${id}/presets/coast`)).toBe(`${THEMES_ADMIN}/${id}/presets/coast`);
    expect(redirected("/admin/platform/store-templates")).toBe(THEMES_ADMIN);
    expect(redirected(`/admin/platform/store-templates/${id}`)).toBe(demoStoreHref(id));
    expect(redirected(`/admin/account/design-profiles/${id}/preview`)).toBe(`/admin/account/themes/${id}/preview`);
  });

  it("leaves the new addresses alone", () => {
    for (const path of [THEMES_ADMIN, `${THEMES_ADMIN}/${id}`, demoStoreHref(id), SITE_DESIGN, `${SITE_DESIGN}/${id}`, `/admin/account/themes/${id}/preview`, "/admin/account/themes/try/calm"]) {
      expect(redirected(path), path).toBeNull();
    }
  });
});

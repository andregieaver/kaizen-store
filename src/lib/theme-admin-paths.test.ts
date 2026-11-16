import { describe, expect, it } from "vitest";

import { SITE_DESIGN, THEMES_ADMIN, demoStoreHref } from "./theme-admin-paths";

const id = "0b6f3c1e-8a2d-4f5b-9c7e-1d2a3b4c5d6e";

describe("themes' addresses in the platform's admin (D273)", () => {
  it("builds the Themes page, a demo store's and the site's Design", () => {
    expect(THEMES_ADMIN).toBe("/admin/platform/themes");
    expect(SITE_DESIGN).toBe("/admin/platform/site-design");
    expect(demoStoreHref(id)).toBe(`/admin/platform/themes/demo-stores/${id}`);
  });
});

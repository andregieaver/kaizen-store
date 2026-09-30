import { describe, expect, it } from "vitest";

import { templatePreviewPath } from "./template-paths";

describe("templatePreviewPath", () => {
  it("is under the owner's account pages, never a new /admin/{word}", () => {
    expect(templatePreviewPath("acme", "3f2c")).toBe("/admin/account/templates/s/acme/3f2c/preview");
  });
});

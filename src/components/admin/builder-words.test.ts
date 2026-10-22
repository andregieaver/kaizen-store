import { describe, expect, it } from "vitest";

import { blocksEn } from "@/lib/admin-messages/blocks.en";
import { builderEn } from "@/lib/admin-messages/builder.en";

import { MAKE_COOL_LABEL, MAKE_COOL_TEXT } from "./make-cool-dialog";
import { REDUCED_NOTE } from "./motion-fields";
import { SAVED_AS_TEMPLATE } from "./save-template-dialog";
import { PREVIEW_DEVICES } from "./templates-helpers";
import { SHARING_NOTE } from "./templates-sharing";

/** The builder's components keep their English words as exported constants for their tests; the catalogue says the same (D312 A7). */
describe("the builder catalogue and the components' own words", () => {
  it("agree in English", () => {
    expect(builderEn.cool.label).toBe(MAKE_COOL_LABEL);
    expect(builderEn.cool.text).toBe(MAKE_COOL_TEXT);
    expect(builderEn.templates.savedAsTemplate).toBe(SAVED_AS_TEMPLATE);
    expect(builderEn.templates.sharingNote).toBe(SHARING_NOTE);
    expect(blocksEn.motion.reduced).toBe(REDUCED_NOTE);
    expect(Object.fromEntries(PREVIEW_DEVICES.map((d) => [d.key, d.label]))).toEqual(builderEn.templates.devices);
  });
});

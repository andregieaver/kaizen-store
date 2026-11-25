import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The page editors' hand-downs (bloat review step 2.25): each editor hands its client parts the areas named below, as an object of the
 * areas' modules (`EDITOR_AREA_WORDS`, `PLATFORM_SITE_AREA_WORDS`) where it once named a list of areas. Each object's keys are the list it
 * replaced, in the same order, and each key is read from its own module (`builder: BUILDER_WORDS`).
 */
const EDITOR = ["builder", "blocks", "fieldsEditor", "productsEditor", "designEditor", "blogEditor", "schedulesEditor", "storeParts", "backdrops", "animation", "builderText", "websitePick", "builderVersions"];
const PLATFORM_SITE = ["designEditor", "builder", "blocks", "fieldsEditor", "productsEditor", "storeParts", "backdrops", "animation", "builderText", "websitePick", "builderVersions", "canva"];
/** A store's editor adds Canva on its picture fields (D898 C2); the sandbox has no Canva. */
const STORE_EDITOR = [...EDITOR, "canva"];

const CASES = [
  { file: "src/app/admin/(gated)/[store]/pages/editor-views.tsx", name: "EDITOR_AREA_WORDS", areas: STORE_EDITOR },
  { file: "src/app/admin/try/[sandbox]/editor.tsx", name: "EDITOR_AREA_WORDS", areas: EDITOR },
  { file: "src/server/platform-site-areas.ts", name: "PLATFORM_SITE_AREA_WORDS", areas: PLATFORM_SITE },
];

const moduleOf = (area: string) => `${area.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}_WORDS`;

describe("the page editors' hand-downs", () => {
  for (const { file, name, areas } of CASES) {
    it(`${file} hands ${name}: its areas, each from its module`, () => {
      const body = new RegExp(`const ${name} = \\{([^}]*)\\}`).exec(readFileSync(join(process.cwd(), file), "utf8"))?.[1];
      expect(body, `${name} in ${file}`).toBeDefined();
      const entries = body!.split(",").map((part) => part.trim()).filter(Boolean).map((part) => part.split(":").map((side) => side.trim()));
      expect(entries.map(([key]) => key)).toEqual(areas);
      for (const [key, value] of entries) expect(value, key).toBe(moduleOf(key));
    });
  }
});

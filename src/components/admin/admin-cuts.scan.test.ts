import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Parts drawn on screens that hand only a cut of an area (bloat review step 2.27, `docs/platform-admin-i18n.md` 3.3, `cut()` in
 * `src/lib/admin-text.ts`): each reads the cut, never the whole area, or the screens that hand the cut alone would fetch the area's
 * English and wait for it (`admin-text-later.ts`). A file here may still read other areas; only the whole areas named are refused.
 */
const READERS: { file: string; whole: string[] }[] = [
  { file: "rich-text-editor.tsx", whole: ["builder"] },
  { file: "text-styles.tsx", whole: ["builder"] },
  { file: "picture-maker.tsx", whole: ["website"] },
  { file: "media-picker.tsx", whole: ["website"] },
  // On every screen, beside the AI manager's button: the chat's words come with its start call.
  { file: "ai-manager-launcher.tsx", whole: ["assistant"] },
  { file: "ai-notices.tsx", whole: ["assistant"] },
  // The store's home hands its drafts card only its own group, and the page lists hand what their rows read.
  { file: "store-drafts.tsx", whole: ["home"] },
  { file: "pages-table.tsx", whole: ["website"] },
  { file: "site-layouts.tsx", whole: ["website"] },
  { file: "duplicate-button.tsx", whole: ["website"] },
  { file: "page-jobs-panel.tsx", whole: ["website"] },
  { file: "demo-home-pages.tsx", whole: ["website"] },
  { file: "demo-home-take.tsx", whole: ["website"] },
];

describe("parts drawn on cut-only screens", () => {
  it("read the cut, not the whole area", () => {
    const found: string[] = [];
    for (const { file, whole } of READERS) {
      const text = readFileSync(join(process.cwd(), "src/components/admin", file), "utf8");
      for (const area of whole) {
        if (text.includes(`useAdminText("${area}")`)) {
          found.push(`${file} reads useAdminText("${area}"): this part is drawn on screens that hand only a cut (docs/platform-admin-i18n.md 3.3): read the cut`);
        }
      }
    }
    expect(found).toEqual([]);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../..");

/**
 * A client module that imports an area's whole English catalogue puts it in the first scripts of every screen that draws the module
 * (PSI PERF-01). The biggest is `admin-text.tsx`: `useAdminText()` reads English for an area a page did not hand down, so it imports every
 * area, about 1 MB of the 3.0 MB every admin screen loads first. Fetching that fallback per area instead was tried on 31 October 2026 and
 * backed out: a part waiting for its area's words is not yet interactive when the page has loaded, so a press that early submitted a form
 * without its script (the content type editor's Save, caught by `e2e/signed-in/content-types.spec.ts`). The way there is for each page to
 * hand down every area its parts read, then the fallback can go. Until then: the modules below already import one, the list may only
 * shrink, and no new client module may join it. `import type` is free.
 */
const ALREADY: readonly string[] = [
  "src/components/admin/admin-text.tsx",
  "src/app/admin/(gated)/[store]/gift-cards/[cardId]/new-code-form.tsx",
  "src/app/admin/(gated)/[store]/gift-cards/new/issue-form.tsx",
  "src/components/admin/admin-text-context.tsx",
  "src/components/admin/audience-fields.tsx",
  "src/components/admin/company-fields.tsx",
  "src/components/admin/delete-reminder-button.tsx",
  "src/components/admin/demo-content-card.tsx",
  "src/components/admin/modal-fields.tsx",
  "src/components/admin/orders/order-table.tsx",
  "src/components/admin/orders/send-parcel.tsx",
  "src/components/admin/orders/view-tools.tsx",
  "src/components/admin/responsive-edit.tsx",
  "src/components/admin/support/conversation-actions.tsx",
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Client modules with a value import of an English admin catalogue. */
function importers(): string[] {
  return files(join(ROOT, "src"))
    .filter((path) => {
      const text = readFileSync(path, "utf8");
      if (!/^\s*["']use client["']/.test(text)) return false;
      return /^import (?!type )[^;]*from "@\/lib\/admin-messages\/[\w-]+\.en";/m.test(text);
    })
    .map((path) => relative(ROOT, path))
    .sort();
}

describe("the admin's English catalogues in client modules (PSI PERF-01)", () => {
  it("is imported whole by no new client module: a part reads its area with useAdminText()", () => {
    expect(importers().filter((path) => !ALREADY.includes(path))).toEqual([]);
  });

  it("keeps the list as short as the code is: a module that stopped is taken off", () => {
    const now = new Set(importers());
    expect(ALREADY.filter((path) => !now.has(path))).toEqual([]);
  });
});

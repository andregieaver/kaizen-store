import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../..");

/**
 * The action refreshes; a client part does not (bloat review step 0.18, AD-13). A server action that changes what the route shows calls
 * `refresh()` (or `redirect()`), and its answer already carries the route drawn again, so a client part that calls `router.refresh()` after
 * it draws every layout and the page a second time. This counts `router.refresh()` per client file under `src/components/admin` and
 * `src/app/admin`: a count may only fall, and a file outside the baseline may have none.
 *
 * The calls that are not after an action stay: `refresh-while.tsx` and `analytics/live-refresh.tsx` (polls), `pack-pictures.tsx`'s
 * `PackPicturesWatch` (a poll), `session.tsx`'s recovery, `admin-text.tsx`'s language change and `data/job-tracker.tsx`. So do the
 * sites whose actions by design do not refresh, where the client call is the only draw.
 *
 * Total at the time of writing (14 November 2026): 92 calls in 50 files.
 */
const BASELINE: Record<string, number> = {
  "src/components/admin/admin-text.tsx": 1,
  "src/components/admin/ai-manager.tsx": 1,
  "src/components/admin/ai-skills.tsx": 2,
  "src/components/admin/analytics/live-refresh.tsx": 2,
  "src/components/admin/automation/rule-editor.tsx": 1,
  "src/components/admin/campaign-editor.tsx": 1,
  "src/components/admin/chat-agent-form.tsx": 1,
  "src/components/admin/content-type-editor.tsx": 1,
  "src/components/admin/customer-import-flow.tsx": 2,
  "src/components/admin/data/import-flow.tsx": 3,
  "src/components/admin/data/job-tracker.tsx": 1,
  "src/components/admin/discount-editor.tsx": 1,
  "src/components/admin/docs-guide-form.tsx": 1,
  "src/components/admin/ebay-parts.tsx": 2,
  "src/components/admin/entry-editor.tsx": 2,
  "src/components/admin/experiment-controls.tsx": 1,
  "src/components/admin/field-group-editor.tsx": 1,
  "src/components/admin/fields-toolbar.tsx": 1,
  "src/components/admin/inventory/inventory-table.tsx": 2,
  "src/components/admin/inventory/locations-view.tsx": 3,
  "src/components/admin/inventory/stock-documents-view.tsx": 1,
  "src/components/admin/inventory/stock-import-flow.tsx": 2,
  "src/components/admin/inventory/suppliers-view.tsx": 5,
  "src/components/admin/media-library.tsx": 10,
  "src/components/admin/menu-editor.tsx": 2,
  "src/components/admin/moving/pipedrive-move.tsx": 3,
  "src/components/admin/moving/shop-address.tsx": 2,
  "src/components/admin/moving/shop-copy.tsx": 2,
  "src/components/admin/moving/shop-makers.tsx": 1,
  "src/components/admin/moving/shop-move.tsx": 2,
  "src/components/admin/moving/shop-undo.tsx": 1,
  "src/components/admin/moving/shopify-closed-button.tsx": 1,
  "src/components/admin/moving/shopify-connect.tsx": 1,
  "src/components/admin/notifications/notification-editor.tsx": 2,
  "src/components/admin/notifications/staff-alerts-form.tsx": 1,
  "src/components/admin/pack-pictures.tsx": 5,
  "src/components/admin/passport-editor.tsx": 1,
  "src/components/admin/products-grid.tsx": 1,
  "src/components/admin/redirects/not-found-table.tsx": 2,
  "src/components/admin/redirects/old-shop-check.tsx": 4,
  "src/components/admin/redirects/redirect-form.tsx": 1,
  "src/components/admin/redirects/redirect-import-flow.tsx": 2,
  "src/components/admin/redirects/redirect-table.tsx": 1,
  "src/components/admin/refresh-while.tsx": 2,
  "src/components/admin/reminder-editor.tsx": 1,
  "src/components/admin/session.tsx": 1,
  "src/components/admin/shipping/method-editor.tsx": 1,
  "src/components/admin/store-drafts.tsx": 1,
  "src/components/admin/stripe-connect-embed.tsx": 1,
  "src/components/admin/two-step-panel.tsx": 2,
};

const MESSAGE = "the action refreshes; a client part does not call router.refresh() after a server action (docs/rules/admin/platform.md)";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : files(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

/** Repo-relative path to the number of `router.refresh()` calls in it, for the files that have any. */
function counts(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const dir of ["src/components/admin", "src/app/admin"]) {
    for (const path of files(join(ROOT, dir))) {
      const n = (readFileSync(path, "utf8").match(/router\.refresh\(\)/g) ?? []).length;
      if (n > 0) found[relative(ROOT, path)] = n;
    }
  }
  return found;
}

describe("router.refresh() in the admin's client parts (bloat review step 0.18)", () => {
  it("is called no more than the baseline allows, and by no file outside it", () => {
    const real = counts();
    const over = Object.entries(real).filter(([path, n]) => n > (BASELINE[path] ?? 0)).map(([path, n]) => `${path}: ${n} (baseline ${BASELINE[path] ?? 0})`);
    expect(over, MESSAGE).toEqual([]);
  });

  it("has no baseline entry above the real count: lower it in the change that removes a call", () => {
    const real = counts();
    const stale = Object.entries(BASELINE).filter(([path, n]) => n > (real[path] ?? 0)).map(([path, n]) => `${path}: baseline ${n}, real ${real[path] ?? 0}`);
    expect(stale).toEqual([]);
  });

  it("totals the baseline", () => {
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(sum(counts())).toBe(sum(BASELINE));
  });
});

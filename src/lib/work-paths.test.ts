// @ts-expect-error Next bundles path-to-regexp, the router's own matcher, without types.
import { compile, match } from "next/dist/compiled/path-to-regexp";
import { describe, expect, it } from "vitest";

import { LEGACY_WORK_REDIRECTS, WORK_ROOT, workBase } from "./work-paths";

/** Where Next would send an address: the first redirect whose source matches, else null. */
function redirected(pathname: string): string | null {
  for (const rule of LEGACY_WORK_REDIRECTS) {
    const found = match(rule.source)(pathname);
    if (found) return compile(rule.destination)(found.params as Record<string, string | string[]>);
  }
  return null;
}

describe("Work's addresses (D123)", () => {
  it("builds a store's Work under the owner's", () => {
    expect(WORK_ROOT).toBe("/admin/account/work");
    expect(workBase("kaffe")).toBe("/admin/account/work/s/kaffe");
  });

  it("sends the old store-level addresses to the new ones", () => {
    expect(redirected("/admin/kaffe/work")).toBe("/admin/account/work/s/kaffe");
    expect(redirected("/admin/kaffe/work/clients")).toBe("/admin/account/work/s/kaffe/clients");
    expect(redirected("/admin/kaffe/work/invoices/abc-123")).toBe("/admin/account/work/s/kaffe/invoices/abc-123");
    expect(redirected("/admin/kaffe/work/invoices/abc-123/print")).toBe("/admin/account/work/s/kaffe/invoices/abc-123/print");
    expect(redirected("/admin/kaffe/work/invoices/export")).toBe("/admin/account/work/s/kaffe/invoices/export");
    expect(redirected("/admin/kaffe/work/reports/csv")).toBe("/admin/account/work/s/kaffe/reports/csv");
    expect(redirected("/admin/kaffe/settings/work")).toBe("/admin/account/work/s/kaffe/settings");
  });

  it("leaves the new addresses, and other admin pages, alone", () => {
    for (const path of [
      WORK_ROOT,
      `${WORK_ROOT}/clients`,
      `${WORK_ROOT}/settings`,
      workBase("kaffe"),
      `${workBase("kaffe")}/invoices/abc`,
      "/admin/platform/work",
      "/admin/kaffe/orders",
      "/admin/kaffe/settings/features",
    ]) {
      expect(redirected(path), path).toBeNull();
    }
  });
});

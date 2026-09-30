import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { StoreSummary } from "@/server/auth";

import { StoresList } from "./stores-list";

const stores: StoreSummary[] = [
  { slug: "kaffe", name: "Kaffe & Co", role: "owner", workOn: false },
  { slug: "te", name: "Te", role: "admin", workOn: false },
];

const html = (props: Record<string, unknown>) =>
  renderToString(createElement(StoresList, { stores, ...props } as Parameters<typeof StoresList>[0])).replace(
    /<!-- -->/g,
    "",
  );

describe("the stores list", () => {
  it("offers Duplicate only on stores the account owns", () => {
    const out = html({ canDuplicate: true });
    expect(out.match(/Duplicate/g)).toHaveLength(1);
    expect(out).toContain('href="/admin/stores/copy/kaffe"');
    expect(out).not.toContain("/admin/stores/copy/te");
    // The whole card still opens the store.
    expect(out).toContain('href="/admin/te"');
  });

  it("offers it on every store to a platform admin", () => {
    const out = html({ canDuplicate: true, platformAdmin: true });
    expect(out.match(/Duplicate/g)).toHaveLength(2);
    expect(out).toContain('href="/admin/stores/copy/te"');
  });

  it("offers none where the account has no room for another store", () => {
    expect(html({ canDuplicate: false })).not.toContain("Duplicate");
    expect(html({})).not.toContain("Duplicate");
  });
});

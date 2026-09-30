import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

import type { PageSummary } from "@/server/pages";

import { PagesTable } from "./pages-table";

const page: PageSummary = {
  id: "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b",
  title: "About us",
  slug: "about",
  state: "published",
  updatedAt: "2026-09-30T10:00:00Z",
  publishedAt: "2026-09-30T10:00:00Z",
  searchEngines: true,
  aiAssistants: true,
  thumbnail: null,
};

const render = (props: Record<string, unknown> = {}) =>
  renderToString(
    createElement(PagesTable, { pages: [page], adminBase: "/admin/x/pages", siteBase: "/s/x/no", ...props }),
  );

describe("the pages list", () => {
  it("offers Duplicate on each page when it is given the action (D126)", () => {
    const html = render({ duplicate: async () => ({ ok: true as const, id: "x" }) });
    expect(html).toContain("Duplicate");
    expect(html).toContain("About us");
  });

  it("offers none without it", () => {
    expect(render()).not.toContain("Duplicate");
  });
});

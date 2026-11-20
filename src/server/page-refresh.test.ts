import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { publishedTags, tagsAfterPublish } = await import("./page-refresh");

/** Which tags a publish refreshes (bloat review step 2.14). */
describe("tagsAfterPublish()", () => {
  it("gives only the page's own tag for a publish that reached only the page", () => {
    expect(tagsAfterPublish("store-1", "p1", "page")).toEqual(["page:p1"]);
  });

  it("gives the page's and the store's pages tag for a publish that reached the site, or one whose reach is not known", () => {
    expect(tagsAfterPublish("store-1", "p1", "site")).toEqual(["page:p1", "pages:store-1"]);
    expect(tagsAfterPublish("store-1", "p1", undefined)).toEqual(["page:p1", "pages:store-1"]);
  });

  it("names Kaizena Flow's own pages tag for its own pages (a null owner)", () => {
    expect(tagsAfterPublish(null, "p1", "site")).toEqual(["page:p1", "platform-pages"]);
    expect(tagsAfterPublish(null, "p1", "page")).toEqual(["page:p1"]);
  });
});

describe("publishedTags(): a schedule run's tags", () => {
  it("refreshes each page published, and a store whole only for a revert or a publish that reached its site", () => {
    expect(
      publishedTags({
        pages: [
          { store: "s1", id: "p1", scope: "page" },
          { store: "s2", id: "p2", scope: "site" },
        ],
        stores: ["s2", "s3"],
      }),
    ).toEqual(["page:p1", "page:p2", "pages:s2", "pages:s3"]);
    expect(publishedTags(null)).toEqual([]);
  });
});

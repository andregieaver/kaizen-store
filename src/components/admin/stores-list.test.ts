import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { homeEn } from "@/lib/admin-messages/home.en";
import { homeNb } from "@/lib/admin-messages/home.nb";

import { StoresList } from "./stores-list";
import { ButtonLink } from "./ui";

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

/** A person with no store (code review step 2.9, D845): the kit's empty state, who to ask, and one way on. */
describe("the stores list with no store", () => {
  it("says so in the kit's empty state, with how to be let in and Start a store", () => {
    const out = html(
      h(StoresList, {
        stores: [],
        words: homeEn.stores,
        emptyText: homeEn.center.noAccessText.replace("{email}", "kari@example.com"),
        emptyAction: h(ButtonLink, { kind: "main", href: "/sign-up" }, homeEn.center.startStore),
      }),
    );
    expect(out).toContain("border-dashed");
    expect(out).toContain(`<p class="text-body-strong text-ink">${homeEn.stores.noAccess}</p>`);
    expect(out).toContain("ask its owner to add you with kari@example.com");
    expect(out).toMatch(/<a [^>]*href="\/sign-up"[^>]*>Start a store<\/a>/);
  });

  it("speaks Norwegian to a Norwegian account, and offers no step where the page has one below", () => {
    const out = html(h(StoresList, { stores: [], words: homeNb.stores, emptyText: homeNb.center.noAccessText.replace("{email}", "kari@example.com") }));
    expect(out).toContain(homeNb.stores.noAccess);
    expect(out).toContain("kan eieren legge deg til med kari@example.com");
    expect(out).not.toContain("<a ");
  });
});

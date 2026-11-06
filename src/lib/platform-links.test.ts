import { describe, expect, it } from "vitest";

import { linkIn, linksIn, type OwnHosts } from "./platform-links";

const hosts: OwnHosts = { site: "kaizenaflow.com", themes: "themes.kaizenaflow.com" };

describe("a link on Kaizena Flow's own pages in another language (D312 P4)", () => {
  it("takes the language's prefix where it is one of the site's own pages", () => {
    expect(linkIn("/sign-up", "nb", hosts)).toBe("/no/sign-up");
    expect(linkIn("/compare", "nb", hosts)).toBe("/no/compare");
    expect(linkIn("/", "nb", hosts)).toBe("/no");
    expect(linkIn("/move-your-store/move-from-shopify#how", "nb", hosts)).toBe("/no/move-your-store/move-from-shopify#how");
    expect(linkIn("/pricing?plan=pro", "nb", hosts)).toBe("/no/pricing?plan=pro");
  });

  it("does the same for a full address on the site's own host or the theme store's", () => {
    expect(linkIn("https://kaizenaflow.com/kaizen-vs-shopify", "nb", hosts)).toBe("https://kaizenaflow.com/no/kaizen-vs-shopify");
    expect(linkIn("https://www.kaizenaflow.com/about-us", "nb", hosts)).toBe("https://www.kaizenaflow.com/no/about-us");
    expect(linkIn("https://themes.kaizenaflow.com/", "nb", hosts)).toBe("https://themes.kaizenaflow.com/no");
    expect(linkIn("https://themes.kaizenaflow.com/calm", "nb", hosts)).toBe("https://themes.kaizenaflow.com/no/calm");
  });

  it("leaves everything else as written", () => {
    for (const href of [
      "/admin",
      "/s/demo/no",
      "/api/fonts/css/inter",
      "/downloads/kaizen-store-wordpress.zip",
      "/no/compare",
      "#how-it-works",
      "mailto:hello@kaizenaflow.com",
      "tel:+4712345678",
      "https://docs.kaizenaflow.com/developers",
      "https://example.com/compare",
      "",
    ]) {
      expect(linkIn(href, "nb", hosts), href).toBe(href);
    }
  });

  it("takes the docs into the language only where they have it", () => {
    const withDocs: OwnHosts = { ...hosts, docs: "docs.kaizenaflow.com" };
    // The front page, search and the owners' track are in Norwegian.
    expect(linkIn("/docs", "nb", withDocs)).toBe("/no/docs");
    expect(linkIn("/docs/owners/getting-started/create-your-store", "nb", withDocs)).toBe("/no/docs/owners/getting-started/create-your-store");
    expect(linkIn("/docs/search?q=vat", "nb", withDocs)).toBe("/no/docs/search?q=vat");
    expect(linkIn("https://docs.kaizenaflow.com/", "nb", withDocs)).toBe("https://docs.kaizenaflow.com/no");
    expect(linkIn("https://docs.kaizenaflow.com/owners/orders#refunds", "nb", withDocs)).toBe("https://docs.kaizenaflow.com/no/owners/orders#refunds");
    // The developers' track, the reference and the changelog are in English alone: their Norwegian address would be a 404.
    for (const href of [
      "/docs/developers/quickstarts/admin-api-token",
      "/docs/reference/admin-api",
      "/docs/changelog",
      "https://docs.kaizenaflow.com/developers/quickstarts/admin-api-token",
      "https://docs.kaizenaflow.com/no/owners/orders",
      "/no/docs/owners/orders",
    ]) {
      expect(linkIn(href, "nb", withDocs), href).toBe(href);
    }
    // "/docsearch" is not the docs.
    expect(linkIn("/docsearch", "nb", withDocs)).toBe("/no/docsearch");
  });

  it("is the page as it is in English", () => {
    expect(linkIn("/sign-up", "en", hosts)).toBe("/sign-up");
    const content = { rows: [{ blocks: [{ type: "button", href: "/sign-up" }] }] };
    expect(linksIn(content, "en", hosts)).toBe(content);
  });
});

describe("a page's links in Norwegian", () => {
  const content = {
    title: "Home",
    css: '.a{background:url("/x.png")} a[href="/sign-up"]{}',
    rows: [
      {
        id: "r",
        columns: [
          {
            id: "c",
            link: { href: "/about-us", label: "About" },
            blocks: [
              { id: "b1", type: "button", href: "https://themes.kaizenaflow.com/", label: "Explore Themes" },
              { id: "b2", type: "dualButton", first: { href: "/sign-up", label: "Start" }, second: { href: "", label: "" } },
              {
                id: "b3",
                type: "richText",
                doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Compare", marks: [{ type: "link", attrs: { href: "/compare" } }] }] }] },
              },
              { id: "b4", type: "heading", text: '<a href="/dream-factory"> <span class="x">NEW!</span> </a> and <a href=\'/pricing\'>prices</a>' },
              { id: "b5", type: "iconList", items: [{ id: "i", text: "Docs", href: "https://docs.kaizenaflow.com", icon: "check" }] },
              { id: "b6", type: "plans", buttonHref: "/sign-up", buttonLabel: "Get started" },
              { id: "b7", type: "domainSearch", ctaHref: "/get-domain", buttonLabel: "" },
              { id: "b8", type: "html", html: '<a href="/compare">kept</a>', title: "Code" },
              { id: "b9", type: "video", link: "https://www.youtube.com/watch?v=x", title: "Film" },
            ],
          },
        ],
      },
    ],
    translations: { "nb-NO": { "block.b4.text": '<a href="/dream-factory">NY!</a>' } },
  };

  it("has every link to the site's own pages in Norwegian, wherever it is written", () => {
    const nb = linksIn(content, "nb", hosts);
    const blocks = nb.rows[0].columns[0].blocks;
    expect(nb.rows[0].columns[0].link.href).toBe("/no/about-us");
    expect(blocks[0].href).toBe("https://themes.kaizenaflow.com/no");
    expect(blocks[1].first?.href).toBe("/no/sign-up");
    expect(blocks[1].second?.href).toBe("");
    expect(blocks[2].doc?.content[0].content[0].marks[0].attrs.href).toBe("/no/compare");
    expect(blocks[3].text).toBe('<a href="/no/dream-factory"> <span class="x">NEW!</span> </a> and <a href=\'/no/pricing\'>prices</a>');
    expect(blocks[4].items?.[0].href).toBe("https://docs.kaizenaflow.com");
    expect(blocks[5].buttonHref).toBe("/no/sign-up");
    expect(blocks[6].ctaHref).toBe("/no/get-domain");
  });

  it("leaves code, video addresses, words and the stored translations as they are", () => {
    const nb = linksIn(content, "nb", hosts);
    const blocks = nb.rows[0].columns[0].blocks;
    expect(nb.css).toBe(content.css);
    expect(blocks[7].html).toBe('<a href="/compare">kept</a>');
    expect(blocks[8].link).toBe("https://www.youtube.com/watch?v=x");
    expect(blocks[0].label).toBe("Explore Themes");
    expect(nb.translations).toBe(content.translations);
    // The page given is not changed.
    expect(content.rows[0].columns[0].blocks[1].first?.href).toBe("/sign-up");
  });
});

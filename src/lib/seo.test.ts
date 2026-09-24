import { describe, expect, it } from "vitest";

import {
  parseRobotsRules,
  parseStoreSeo,
  renderLlms,
  renderRobots,
  seoFromForm,
  storeRobotsGroups,
  storeSeoInput,
  summarize,
} from "./seo";

describe("parseStoreSeo", () => {
  it("fills in defaults, keeping what is valid", () => {
    const seo = parseStoreSeo({ title: { "nb-NO": "Kopper" }, hidden: "yes", sameAs: "x" });
    expect(seo).toMatchObject({
      title: { "nb-NO": "Kopper" },
      hidden: false,
      sameAs: [],
      aiAssistants: true,
      aiTraining: true,
      image: null,
      verification: { google: "", bing: "" },
    });
    expect(parseStoreSeo(null).robots).toBe("");
  });
});

describe("summarize", () => {
  it("keeps short text and cuts long text at a word", () => {
    expect(summarize("  A   mug.\n")).toBe("A mug.");
    const cut = summarize("word ".repeat(60), 30);
    expect(cut.length).toBeLessThanOrEqual(30);
    expect(cut.endsWith("word…")).toBe(true);
  });
});

describe("robots.txt", () => {
  it("reads a store's rules under its address and reports mistakes", () => {
    const { groups, problems } = parseRobotsRules(
      "# old pages\nDisallow: /no/p/old\nUser-agent: Googlebot\nUser-agent: Bingbot\nAllow: *.pdf\nCrawl-delay: 5\nDisallow: private",
      { prefix: "/s/kopp" },
    );
    expect(groups.get("*")).toEqual([{ allow: false, path: "/s/kopp/no/p/old" }]);
    expect(groups.get("Googlebot")).toEqual([{ allow: true, path: "/s/kopp/*.pdf" }]);
    expect(groups.get("Bingbot")).toEqual(groups.get("Googlebot"));
    expect(problems).toEqual([
      'Line 6: "Crawl-delay" is not supported here. Use User-agent, Allow or Disallow.',
      "Line 7: a path starts with / (for example /private).",
    ]);
  });

  it("repeats the rules for everyone in each named group, since crawlers follow only their own", () => {
    const seo = parseStoreSeo({ aiTraining: false });
    const text = renderRobots(storeRobotsGroups(seo, "/s/kopp"), ["https://x.test/sitemap.xml"]);
    expect(text).toContain("User-agent: *\nDisallow: /s/kopp/*/cart\nDisallow: /s/kopp/*/checkout\nDisallow: /s/kopp/*/order/\nDisallow: /s/kopp/*/download\nDisallow: /s/kopp/*/subscription/\nDisallow: /s/kopp/*/account\n");
    expect(text).toContain(
      "User-agent: GPTBot\nDisallow: /s/kopp/*/cart\nDisallow: /s/kopp/*/checkout\nDisallow: /s/kopp/*/order/\nDisallow: /s/kopp/*/download\nDisallow: /s/kopp/*/subscription/\nDisallow: /s/kopp/*/account\nDisallow: /s/kopp/",
    );
    expect(text).not.toContain("User-agent: ChatGPT-User");
    expect(text.trimEnd().endsWith("Sitemap: https://x.test/sitemap.xml")).toBe(true);
  });

  it("allows sitemaps only where asked", () => {
    expect(parseRobotsRules("Sitemap: https://x.test/s.xml").problems).toHaveLength(1);
    expect(parseRobotsRules("Sitemap: https://x.test/s.xml", { sitemaps: true }).sitemaps).toEqual([
      "https://x.test/s.xml",
    ]);
  });
});

describe("renderLlms", () => {
  it("writes the llmstxt.org layout and skips empty sections", () => {
    expect(
      renderLlms({
        name: "Kopp [&] co",
        summary: "Cups\nfrom Oslo.",
        text: "  Hand made.  ",
        sections: [
          { heading: "Products", links: [{ title: "Mug [white]", url: "https://x.test/p/mug", note: "NOK 249.00" }] },
          { heading: "Empty", links: [] },
        ],
      }),
    ).toBe(
      "# Kopp [&] co\n\n> Cups from Oslo.\n\nHand made.\n\n## Products\n\n- [Mug white](https://x.test/p/mug): NOK 249.00\n",
    );
  });
});

describe("the settings form", () => {
  it("turns fields into settings the checks accept", () => {
    const form = new FormData();
    form.set("title:nb-NO", " Kopper fra Oslo ");
    form.set("imageUrl", "https://x.test/share.webp");
    form.set("imageAlt:nb-NO", "Kopper på et bord");
    form.set("sameAs", "https://instagram.com/kopp\n\nhttps://facebook.com/kopp");
    form.set("aiChoices", "1");
    form.set("aiAssistants", "on");
    form.set("google", '<meta name="google-site-verification" content="abc_123-X" />');
    const parsed = storeSeoInput.parse(seoFromForm(form, ["nb-NO", "sv-SE"]));
    expect(parsed).toMatchObject({
      title: { "nb-NO": "Kopper fra Oslo", "sv-SE": "" },
      image: { url: "https://x.test/share.webp", alt: { "nb-NO": "Kopper på et bord" } },
      sameAs: ["https://instagram.com/kopp", "https://facebook.com/kopp"],
      hidden: false,
      aiAssistants: true,
      aiTraining: false,
      verification: { google: "abc_123-X", bing: "" },
    });
  });

  it("leaves AI crawlers allowed when the form has no AI choices (Kaizen's own settings)", () => {
    expect(seoFromForm(new FormData(), ["en"])).toMatchObject({ aiAssistants: true, aiTraining: true, image: null });
  });

  it("refuses profiles that are not addresses and odd verification codes", () => {
    const form = new FormData();
    form.set("sameAs", "instagram");
    form.set("bing", "not a code!");
    const result = storeSeoInput.safeParse(seoFromForm(form, ["en"]));
    expect(result.success).toBe(false);
  });
});

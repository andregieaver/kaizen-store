import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { pageKnowledgeText } from "./knowledge";
import { blockText, newPageContent, pageExcerpt, type ContentGridBlock, type PageContent } from "./page-content";
import { newBlock } from "./page-rows";

/**
 * A custom grid item (D155) is never a product and never the page's own words: its price text is plain words, and nothing of
 * it reaches structured data, the sitemap, llms.txt, search, feeds, recommendations or the chat agent. Two checks: what the
 * page's words are (the excerpt, the agent's knowledge) leave a custom grid out, and no module of those places refers to custom
 * items at all.
 */

const secret = "Zanzibar-Cruise";
const page = (): PageContent => ({
  ...newPageContent(),
  title: "Tours",
  slug: "tours",
  rows: [
    {
      id: "r1",
      type: "row",
      layout: "1",
      columns: [
        {
          id: "c1",
          blocks: [
            {
              ...(newBlock("contentGrid", () => "g1") as ContentGridBlock),
              source: { type: "custom" },
              items: [
                { id: "i1", title: secret, text: `${secret} text`, picture: null, link: null, buttonLabel: "", date: null, badge: `${secret} badge`, priceText: `From ${secret} kr`, details: [{ id: "d1", label: "L", text: secret }] },
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe("a page's words", () => {
  it("leave a custom grid out: the excerpt (the description structured data and llms.txt use), the agent's knowledge and every block's text", () => {
    const content = page();
    expect(pageExcerpt(content)).not.toContain(secret);
    expect(pageKnowledgeText(content)).not.toContain(secret);
    expect(blockText(content.rows[0].columns[0].blocks[0])).toBe("");
  });
});

describe("the places a custom item must never reach", () => {
  const root = path.resolve(__dirname, "../..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  const files = walk(path.join(root, "src"))
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file));

  /** Structured data, the sitemaps, llms.txt, robots, search, feeds, recommendations, knowledge and the chat agent. */
  const PLACES = /(structured-data|\/seo\.ts|sitemap|llms|robots|\/search|search-|-search|feed|recommend|knowledge|chat)/;
  /** Where a grid's own components and the admin may talk of custom items. */
  const OWN = /^src\/(components|app\/admin)\//;
  /** Words that only custom items have. */
  const CUSTOM = /(custom-grid|customGridData|CustomGridItem|customItemShows|shownCustomItems|itemLinkHref|\.priceText\b|\bpriceText\??:|CUSTOM_ITEMS_MAX)/;

  const places = files.filter((file) => PLACES.test(file) && !OWN.test(file) && !/^src\/lib\/(custom-grid|grid-source)/.test(file));

  it("finds those places, so the check is not empty", () => {
    expect(places.length).toBeGreaterThan(20);
    for (const needle of ["src/lib/structured-data.ts", "src/server/seo.ts", "src/app/llms.txt/route.ts", "src/app/sitemap.xml/route.ts", "src/server/search.ts", "src/server/recommend.ts", "src/server/chat-agent.ts", "src/server/knowledge.ts"]) {
      expect(places, needle).toContain(needle);
    }
  });

  it("never refer to a custom item", () => {
    const guilty = places.filter((file) => CUSTOM.test(readFileSync(path.join(root, file), "utf8")));
    expect(guilty).toEqual([]);
  });

  it("never read a content grid's items either", () => {
    // `items` of a content grid block is the one place a custom item lives; these places read pages only through blockText().
    const guilty = places.filter((file) => /contentGrid/.test(readFileSync(path.join(root, file), "utf8")) && /\.items\b/.test(readFileSync(path.join(root, file), "utf8")));
    expect(guilty).toEqual([]);
  });
});

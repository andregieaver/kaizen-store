import { describe, expect, it } from "vitest";

import { classifyHref, headingId, parseMarkdown, plainText, type Block, type Inline } from "./docs-markdown";

const blocks = (md: string) => parseMarkdown(md).blocks;
const inline = (md: string) => (blocks(md)[0] as Extract<Block, { type: "paragraph" }>).children;

/** Every inline node of a tree, depth first. */
function inlines(tree: readonly Block[]): Inline[] {
  const out: Inline[] = [];
  const walkInline = (nodes: readonly Inline[]) => {
    for (const node of nodes) {
      out.push(node);
      if ("children" in node) walkInline(node.children);
    }
  };
  const walk = (list: readonly Block[]) => {
    for (const block of list) {
      if (block.type === "paragraph" || block.type === "heading") walkInline(block.children);
      if (block.type === "list") block.items.forEach(walk);
      if (block.type === "callout" || block.type === "quote") walk(block.children);
      if (block.type === "table") [...block.head, ...block.rows.flat()].forEach(walkInline);
    }
  };
  walk(tree);
  return out;
}

describe("the docs' Markdown: what it reads (D442)", () => {
  it("reads headings with stable ids, Norwegian letters spelled out, repeats numbered and its own ids kept", () => {
    const doc = parseMarkdown("## Sign up\n\n### Før du åpner\n\n## Sign up\n\n## Rate limits {#limits}\n\n#### Small");
    expect(doc.headings).toEqual([
      { depth: 2, id: "sign-up", text: "Sign up" },
      { depth: 3, id: "for-du-apner", text: "Før du åpner" },
      { depth: 2, id: "sign-up-2", text: "Sign up" },
      { depth: 2, id: "limits", text: "Rate limits" },
      { depth: 4, id: "small", text: "Small" },
    ]);
    expect(doc.problems).toEqual([]);
    expect(headingId("Ærlig talt: «Kaizena» & co.")).toBe("aerlig-talt-kaizena-co");
  });

  it("refuses a title heading and headings past ####, keeping them as h2 and h4", () => {
    const doc = parseMarkdown("# Title\n\n###### Deep", 5);
    expect(doc.problems.map((p) => p.line)).toEqual([5, 7]);
    expect(doc.blocks.map((b) => b.type === "heading" && b.depth)).toEqual([2, 4]);
  });

  it("reads paragraphs with strong, emphasis, code and links, joining its lines", () => {
    expect(inline("Press **Save** and *then* `kf_…`\nnext line")).toEqual([
      { type: "text", value: "Press " },
      { type: "strong", children: [{ type: "text", value: "Save" }] },
      { type: "text", value: " and " },
      { type: "em", children: [{ type: "text", value: "then" }] },
      { type: "text", value: " " },
      { type: "code", value: "kf_…" },
      { type: "text", value: " next line" },
    ]);
    expect(inline("snake_case_word and __strong__ and _em_")).toEqual([
      { type: "text", value: "snake_case_word and " },
      { type: "strong", children: [{ type: "text", value: "strong" }] },
      { type: "text", value: " and " },
      { type: "em", children: [{ type: "text", value: "em" }] },
    ]);
    expect(inline("*a **b** c*")).toEqual([{ type: "em", children: [{ type: "text", value: "a " }, { type: "strong", children: [{ type: "text", value: "b" }] }, { type: "text", value: " c" }] }]);
    expect(inline("2 * 3 * 4 and a\\*b")).toEqual([{ type: "text", value: "2 * 3 * 4 and a*b" }]);
    expect(inline("`` a ` b ``")).toEqual([{ type: "code", value: "a ` b" }]);
    expect(inline("line one\\\nline two")).toEqual([{ type: "text", value: "line one" }, { type: "break" }, { type: "text", value: "line two" }]);
  });

  it("reads lists, nested and ordered, and a blank line between items", () => {
    const [list] = blocks("1. First\n2. Second\n   - inner a\n   - inner b\n\n3. Third\n   continued");
    expect(list).toMatchObject({ type: "list", ordered: true, start: 1 });
    const items = (list as Extract<Block, { type: "list" }>).items;
    expect(items).toHaveLength(3);
    expect(items[1][1]).toMatchObject({ type: "list", ordered: false, items: [[{ type: "paragraph" }], [{ type: "paragraph" }]] });
    expect(plainText((items[2][0] as Extract<Block, { type: "paragraph" }>).children)).toBe("Third continued");
    expect(blocks("3. three\n4. four")[0]).toMatchObject({ start: 3 });
    expect(blocks("- a\n- b\n\nAfter")).toMatchObject([{ type: "list" }, { type: "paragraph" }]);
  });

  it("reads tables with alignment, code with pipes and escaped pipes", () => {
    const [table] = blocks("| Scope | What `a|b` | N |\n|:---|---|---:|\n| `x` | y \\| z | 1 |\n| short |");
    expect(table).toMatchObject({ type: "table", align: ["left", null, "right"] });
    const t = table as Extract<Block, { type: "table" }>;
    expect(plainText(t.head[1])).toBe("What a|b");
    expect(plainText(t.rows[0][1])).toBe("y | z");
    expect(t.rows[1].map(plainText)).toEqual(["short", "", ""]);
    // An escaped pipe in code is a pipe, as GitHub reads a table (the generated reference escapes every one, E4).
    const [escaped] = blocks("| Pattern |\n|---|\n| `^(a\\|b)$` |");
    const cell = (escaped as Extract<Block, { type: "table" }>).rows[0][0];
    expect(cell).toEqual([{ type: "code", value: "^(a|b)$" }]);
  });

  it("reads fenced code with its language, coloured, and keeps what is inside as written", () => {
    const [code] = blocks('```json\n{ "a": "<b>" }\n```');
    expect(code).toMatchObject({ type: "code", lang: "json", value: '{ "a": "<b>" }' });
    expect((code as Extract<Block, { type: "code" }>).tokens.map((t) => t.text).join("")).toBe('{ "a": "<b>" }');
    expect(parseMarkdown("```\nnot closed").problems[0].message).toMatch(/not closed/);
    expect(parseMarkdown("```cobol\nx\n```").problems[0].message).toMatch(/not one the docs know/);
    // A fence inside a longer fence is text.
    expect(blocks("````md\n```\ninner\n```\n````")).toMatchObject([{ type: "code", value: "```\ninner\n```" }]);
  });

  it("reads callouts, quotes, rules and pictures from the repository", () => {
    expect(blocks("> [!WARNING]\n> Keep it **secret**.")).toMatchObject([{ type: "callout", tone: "warning", children: [{ type: "paragraph" }] }]);
    expect(blocks("> Just a quote")).toMatchObject([{ type: "quote" }]);
    expect(parseMarkdown("> [!DANGER]\n> x").problems[0].message).toMatch(/callout/);
    expect(blocks("---")).toEqual([{ type: "rule" }]);
    expect(blocks("![The setup list](/kaizen/docs/setup.png)")).toEqual([{ type: "image", src: "/kaizen/docs/setup.png", alt: "The setup list" }]);
    const doc = parseMarkdown("![](/kaizen/docs/a.png)\n\n![x](https://evil.example/a.png)\n\ntext ![inline](/kaizen/docs/b.png)");
    expect(doc.problems.map((p) => p.message)).toEqual([expect.stringMatching(/says what it shows/), expect.stringMatching(/from the repository/), expect.stringMatching(/line of its own/)]);
    expect(doc.blocks.filter((b) => b.type === "image")).toHaveLength(1);
  });
});

describe("the docs' Markdown: what it refuses (D442, never HTML)", () => {
  it("keeps HTML as the characters typed, and says so", () => {
    const doc = parseMarkdown('Hello <script>alert(1)</script> and <img src=x onerror="alert(1)">');
    expect(doc.blocks).toEqual([{ type: "paragraph", children: [{ type: "text", value: 'Hello <script>alert(1)</script> and <img src=x onerror="alert(1)">' }] }]);
    expect(doc.problems).toHaveLength(1);
    expect(doc.problems[0].message).toMatch(/HTML is not allowed/);
    // A whole line of HTML is a paragraph of text too, and an HTML comment.
    expect(parseMarkdown("<div onclick=alert(1)>x</div>").blocks[0]).toMatchObject({ type: "paragraph", children: [{ type: "text", value: "<div onclick=alert(1)>x</div>" }] });
    expect(parseMarkdown("<!-- hidden -->").problems).toHaveLength(1);
    // In code it is an example, not a problem.
    expect(parseMarkdown("Write `<b>` like this.").problems).toEqual([]);
    expect(parseMarkdown("1 < 2 and a<b").problems).toEqual([]);
  });

  it("refuses every link that is not a docs page, a heading, the site, the admin or https, http or mailto", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "java&#115;cript:alert(1)",
      "%6Aavascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox",
      "//evil.example/x",
      "relative/path",
      "../up",
      "ftp://x.example",
      "https://user:pass@x.example",
      "file:///etc/passwd",
      "#Not-An-Id",
      "/docs/../admin",
      "/docs/owners#",
      "/admin/{store}/x#y",
    ]) {
      expect(classifyHref(bad), bad).toBeNull();
    }
    const doc = parseMarkdown("[click](javascript:alert(1)) and [ok](https://kaizenaflow.com)");
    expect(doc.problems).toHaveLength(1);
    const nodes = inlines(doc.blocks);
    expect(nodes.filter((n) => n.type === "link")).toEqual([{ type: "link", href: { kind: "external", url: "https://kaizenaflow.com" }, children: [{ type: "text", value: "ok" }] }]);
    // The refused link's words stay, as text.
    expect(plainText(inline("[click](javascript:alert(1)) here"))).toBe("click here");
  });

  it("names what each link goes to", () => {
    expect(classifyHref("/docs")).toEqual({ kind: "doc", path: "", anchor: null });
    expect(classifyHref("/docs/owners/getting-started/create-your-store#sign-up")).toEqual({ kind: "doc", path: "owners/getting-started/create-your-store", anchor: "sign-up" });
    expect(classifyHref("/docs/changelog/")).toEqual({ kind: "doc", path: "changelog", anchor: null });
    expect(classifyHref("#rate-limits")).toEqual({ kind: "anchor", id: "rate-limits" });
    expect(classifyHref("/sign-up?theme=calm")).toEqual({ kind: "site", path: "/sign-up?theme=calm" });
    expect(classifyHref("/admin/{store}/settings/api")).toEqual({ kind: "admin", path: "/admin/{store}/settings/api" });
    expect(classifyHref("mailto:hello@kaizenaflow.com")).toEqual({ kind: "external", url: "mailto:hello@kaizenaflow.com" });
    expect(classifyHref("<https://x.example>")).toBeNull();
    expect(inline("<https://kaizenaflow.com/status>")).toEqual([
      { type: "link", href: { kind: "external", url: "https://kaizenaflow.com/status" }, children: [{ type: "text", value: "https://kaizenaflow.com/status" }] },
    ]);
  });

  it("keeps links out of links, and a link's title out of the tree", () => {
    expect(inline('[a [b](/x) c](/docs "Title")')).toEqual([
      { type: "link", href: { kind: "doc", path: "", anchor: null }, children: [{ type: "text", value: "a [b](/x) c" }] },
    ]);
  });
});

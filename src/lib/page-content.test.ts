import { describe, expect, it } from "vitest";

import {
  RESERVED_PAGE_SLUGS,
  cleanRichText,
  isLinkAddress,
  newPageContent,
  pageExcerpt,
  pageInput,
  pageSlugFromTitle,
  pageSlugProblem,
  richTextPlain,
  type RichTextDoc,
} from "./page-content";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const p = (text: string, marks?: unknown[]) => ({ type: "paragraph", content: [{ type: "text", text, ...(marks && { marks }) }] });

describe("link addresses", () => {
  it("takes web, mail and phone addresses, site paths and anchors", () => {
    for (const href of ["https://kaizen.no", "http://example.com/a?b=c", "mailto:hei@kaizen.no", "tel:+4712345678", "/sign-up", "#pricing"]) {
      expect(isLinkAddress(href), href).toBe(true);
    }
  });

  it("refuses scripts, other protocols and addresses to another site without a scheme", () => {
    for (const href of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x", "//evil.example", "/\\evil.example", "ftp://x", "", "https://a b"]) {
      expect(isLinkAddress(href), href).toBe(false);
    }
  });
});

describe("rich text", () => {
  it("keeps what the editor offers and drops unknown attributes", () => {
    const cleaned = cleanRichText(
      doc(
        { type: "heading", attrs: { level: 2, id: "x" }, content: [{ type: "text", text: "Hei" }] },
        p("bold", [{ type: "bold" }, { type: "link", attrs: { href: "https://kaizen.no", target: "_blank", class: "x" } }]),
        { type: "bulletList", content: [{ type: "listItem", content: [p("one")] }] },
        { type: "orderedList", attrs: { start: 3, type: null }, content: [{ type: "listItem", content: [p("three")] }] },
        { type: "blockquote", content: [p("quote")] },
        { type: "horizontalRule" },
        { type: "paragraph", content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }] },
      ),
    );
    expect(cleaned.ok).toBe(true);
    if (!cleaned.ok) return;
    expect(cleaned.doc.content[0]).toEqual({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Hei" }] });
    expect(cleaned.doc.content[1]).toEqual(
      p("bold", [{ type: "bold" }, { type: "link", attrs: { href: "https://kaizen.no" } }]),
    );
    expect(cleaned.doc.content[3]).toMatchObject({ type: "orderedList", attrs: { start: 3 } });
  });

  it("refuses scripts in links, unknown blocks and marks, and wrong heading levels", () => {
    expect(cleanRichText(doc(p("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }])))).toMatchObject({ ok: false });
    expect(cleanRichText(doc({ type: "image", attrs: { src: "https://x" } }))).toMatchObject({ ok: false });
    expect(cleanRichText(doc(p("x", [{ type: "code" }])))).toMatchObject({ ok: false });
    expect(cleanRichText(doc({ type: "heading", attrs: { level: 1 }, content: [] }))).toMatchObject({ ok: false });
    expect(cleanRichText(doc({ type: "paragraph", content: [{ type: "text", text: 5 }] }))).toMatchObject({ ok: false });
    expect(cleanRichText("<p>hi</p>")).toMatchObject({ ok: false });
  });

  it("refuses documents nested too deeply or too long", () => {
    let node: unknown = p("deep");
    for (let i = 0; i < 20; i++) node = { type: "blockquote", content: [node] };
    expect(cleanRichText(doc(node))).toMatchObject({ ok: false, problem: expect.stringMatching(/nested/) });
    expect(cleanRichText(doc(p("x".repeat(50_001))))).toMatchObject({ ok: false });
  });

  it("gives an empty document one empty paragraph", () => {
    expect(cleanRichText(doc())).toEqual({ ok: true, doc: { type: "doc", content: [{ type: "paragraph" }] } });
  });

  it("reads the words, one line per block", () => {
    const text = richTextPlain(
      doc(p("First"), { type: "bulletList", content: [{ type: "listItem", content: [p("item")] }] }, { type: "horizontalRule" }) as RichTextDoc,
    );
    expect(text).toBe("First\nitem");
  });
});

describe("page addresses", () => {
  it("suggests an address from the title", () => {
    expect(pageSlugFromTitle("Om oss & våre priser")).toBe("om-oss-vare-priser");
    expect(pageSlugFromTitle("Admin")).toBe("admin-page");
    expect(pageSlugFromTitle("")).toBe("");
  });

  it("says why an address cannot be used", () => {
    expect(pageSlugProblem("about")).toBeNull();
    expect(pageSlugProblem("")).toMatch(/address/);
    expect(pageSlugProblem("About")).toMatch(/lowercase/);
    expect(pageSlugProblem("a--b")).toMatch(/single hyphens/);
    for (const slug of RESERVED_PAGE_SLUGS) expect(pageSlugProblem(slug)).toMatch(/used by Kaizen/);
  });
});

describe("page input", () => {
  const valid = {
    ...newPageContent(),
    title: " About Kaizen ",
    slug: "about",
    blocks: [{ id: "b1", type: "richText", doc: doc(p("Hello there")) }],
  };

  it("accepts a page and trims its texts", () => {
    const parsed = pageInput.parse(valid);
    expect(parsed.title).toBe("About Kaizen");
    expect(pageExcerpt(parsed)).toBe("Hello there");
  });

  it("names every problem", () => {
    const result = pageInput.safeParse({
      ...valid,
      title: "",
      slug: "sign-up",
      thumbnail: { url: "javascript:alert(1)", width: 10, height: 10, alt: "" },
      blocks: [
        { id: "b1", type: "richText", doc: doc(p("x", [{ type: "link", attrs: { href: "javascript:x" } }])) },
        { id: "b1", type: "richText", doc: doc(p("y")) },
      ],
    });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((i) => i.message).join("\n");
    expect(messages).toMatch(/title/);
    expect(messages).toMatch(/used by Kaizen/);
    expect(messages).toMatch(/picture/);
    expect(messages).toMatch(/not a link address/);
  });

  it("refuses unknown block types", () => {
    expect(pageInput.safeParse({ ...valid, blocks: [{ id: "x", type: "html", html: "<script>" }] }).success).toBe(false);
  });
});

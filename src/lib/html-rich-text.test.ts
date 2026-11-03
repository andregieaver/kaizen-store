import { describe, expect, it } from "vitest";

import { decodeEntities, htmlToRichText } from "./html-rich-text";
import { cleanRichText } from "./page-content";

const doc = (html: string) => htmlToRichText(html).doc;

describe("HTML into the editor's rich text", () => {
  it("keeps paragraphs, headings 2 to 4, bold, italic, underline and links", () => {
    expect(doc("<h1>About</h1><p>We make <strong>bags</strong> by <em>hand</em> in <u>Oslo</u>. <a href=\"/pages/contact\">Write to us</a>.</p><h5>Small</h5>")).toEqual({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "About" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "We make " },
            { type: "text", text: "bags", marks: [{ type: "bold" }] },
            { type: "text", text: " by " },
            { type: "text", text: "hand", marks: [{ type: "italic" }] },
            { type: "text", text: " in " },
            { type: "text", text: "Oslo", marks: [{ type: "underline" }] },
            { type: "text", text: ". " },
            { type: "text", text: "Write to us", marks: [{ type: "link", attrs: { href: "/pages/contact" } }] },
            { type: "text", text: "." },
          ],
        },
        { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "Small" }] },
      ],
    });
  });

  it("keeps bullet and numbered lists, nested ones in their item, and quotes and lines", () => {
    expect(doc("<ul><li>One<ul><li>One a</li></ul></li><li>Two</li></ul><ol start=\"3\"><li>Three</li></ol><blockquote><p>Said</p></blockquote><hr>")).toEqual({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "One a" }] }] }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Two" }] }] },
          ],
        },
        { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Three" }] }] }] },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Said" }] }] },
        { type: "horizontalRule" },
      ],
    });
  });

  it("reduces divs, spans and tables to their words, and leaves out scripts, styles, frames and pictures (counted)", () => {
    const { doc: d, picturesLeftOut } = htmlToRichText(
      '<div><span style="color:red">Red</span> text<script>alert(1)</script></div><style>p{}</style><iframe src="x"></iframe><img src="a.jpg"><table><tr><td>A</td><td>B</td></tr></table><p>Line<br>break</p>',
    );
    expect(d).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Red" }, { type: "text", text: " text" }] },
        { type: "paragraph", content: [{ type: "text", text: "A" }, { type: "text", text: " " }, { type: "text", text: "B" }] },
        { type: "paragraph", content: [{ type: "text", text: "Line" }, { type: "hardBreak" }, { type: "text", text: "break" }] },
      ],
    });
    expect(picturesLeftOut).toBe(1);
  });

  it("keeps a link's words without a link the editor does not take, and decodes characters", () => {
    expect(doc('<p><a href="javascript:alert(1)">Click</a> &amp; <a href="relative/x">more</a> &oslash; &#229; &#x2014;</p>')).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Click" }, { type: "text", text: " & " }, { type: "text", text: "more" }, { type: "text", text: " ø å —" }] }],
    });
    expect(decodeEntities("&unknown; &lt;b&gt;")).toBe("&unknown; <b>");
  });

  it("always gives what the editor's own check takes, even for broken HTML", () => {
    for (const html of ["", "<p>unclosed <b>bold", "</ul></li>text<li>loose", "<<<>>>", "<ul>text in list</ul>", "<blockquote></blockquote>", "<h2><ul><li>x</li></ul></h2>"]) {
      expect(cleanRichText(doc(html)).ok, html).toBe(true);
    }
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { Inline } from "@/components/inline-text";
import { inlinePlain, parseInline } from "./inline-text";

const html = (text: string, links = false) => renderToStaticMarkup(createElement("p", null, createElement(Inline, { text, links })));

describe("inline markup in builder texts", () => {
  it("draws a span with a class, as written and in the shorthand", () => {
    expect(html('KaizenLabs - brewing the future<span class="highlight-color">.</span>')).toBe('<p>KaizenLabs - brewing the future<span class="highlight-color">.</span></p>');
    expect(html('Brewing<span="highlight-color">.</span>')).toBe('<p>Brewing<span class="highlight-color">.</span></p>');
  });

  it("draws bold, italics and breaks, and plain text as it is", () => {
    expect(html("A <strong>bold</strong> and <em>soft</em><br>line")).toBe("<p>A <strong>bold</strong> and <em>soft</em><br/>line</p>");
    expect(html("Just words & more")).toBe("<p>Just words &amp; more</p>");
    expect(html("3 < 4 and 5 > 2")).toBe("<p>3 &lt; 4 and 5 &gt; 2</p>");
  });

  it("never lets anything else through: it stays text", () => {
    expect(html('<script>alert(1)</script>')).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
    expect(html('<img src=x onerror="alert(1)">')).toBe('<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>');
    // Attributes other than a class are dropped; a class is a name and no more.
    expect(html('<span onclick="x()" style="color:red" class="a b">t</span>')).toBe('<p><span class="a b">t</span></p>');
    expect(html('<span class="a&quot; onmouseover=&quot;x ok">t</span>')).toBe('<p><span class="ok">t</span></p>');
    expect(html('<strong class="1bad {x}">t</strong>')).toBe("<p><strong>t</strong></p>");
  });

  it("allows links only where they are allowed, and only to safe addresses", () => {
    expect(html('<a href="/kontakt">Contact</a>', true)).toBe('<p><a href="/kontakt">Contact</a></p>');
    expect(html('<a href="https://example.com">x</a>', true)).toBe('<p><a href="https://example.com" rel="noopener noreferrer">x</a></p>');
    expect(html('<a href="/kontakt">Contact</a>')).toBe("<p><span>Contact</span></p>");
    for (const bad of ["javascript:alert(1)", "data:text/html;base64,AAAA", "//evil.example", "vbscript:x"]) {
      expect(html(`<a href="${bad}">x</a>`, true)).toBe("<p>x</p>");
    }
  });

  it("is forgiving: unclosed tags close at the end, a stray closing tag is shown", () => {
    expect(html("<strong>never closed")).toBe("<p><strong>never closed</strong></p>");
    expect(html("a</strong>b")).toBe("<p>a&lt;/strong&gt;b</p>");
    expect(html("<em><strong>x</em>y")).toBe("<p><em><strong>x</strong></em>y</p>");
  });

  it("limits how deep it nests", () => {
    const deep = "<b>".repeat(30) + "x";
    expect(parseInline(deep).length).toBe(1);
    expect(html(deep).match(/<b>/g)?.length).toBeLessThanOrEqual(7);
  });

  it("gives the plain words for search, excerpts and labels", () => {
    expect(inlinePlain('Brewing the future<span class="highlight-color">.</span>')).toBe("Brewing the future.");
    expect(inlinePlain("One<br>two &amp; three")).toBe("One two & three");
    expect(inlinePlain("plain")).toBe("plain");
  });
});

describe("the blocks that draw it", () => {
  it("a heading, a button and a caption take the markup; the page's words leave it out", async () => {
    const { PageBlockView } = await import("@/components/page-block");
    const { blockText } = await import("./page-content");
    const { newBlock } = await import("./page-rows");
    const id = () => "b1";
    const heading = { ...newBlock("heading", id), text: 'Brewing the future<span class="highlight-color">.</span>' } as Parameters<typeof PageBlockView>[0]["block"];
    const out = renderToStaticMarkup(createElement(PageBlockView, { block: heading }));
    expect(out).toContain('Brewing the future<span class="highlight-color">.</span></h');
    expect(blockText(heading)).toBe("Brewing the future.");
    const button = { ...newBlock("button", id), label: "Buy <strong>now</strong>", href: "/kjop" } as Parameters<typeof PageBlockView>[0]["block"];
    expect(renderToStaticMarkup(createElement(PageBlockView, { block: button }))).toContain("Buy <strong>now</strong>");
    // A link in a button's words would be a link inside a link: it is only its words there.
    const linked = { ...button, label: 'Go <a href="/x">here</a>' } as typeof button;
    expect(renderToStaticMarkup(createElement(PageBlockView, { block: linked }))).not.toMatch(/<a [^>]*><a /);
  });
});

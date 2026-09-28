import { describe, expect, it } from "vitest";

import { blockHasContent, blockText, EMPTY_DOC, newPageContent, pageInput, type RichTextDoc } from "./page-content";
import { newBlock } from "./page-rows";
import { blockTextFields, localizePage } from "./page-translation";
import { faqJsonLd } from "./seo";

const doc = (text: string): RichTextDoc => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** The newer page components (D91): what each keeps, refuses and shows. */

const page = (blocks: unknown[]) => ({
  ...newPageContent(),
  title: "Components",
  slug: "components",
  rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks }] }],
});
const parse = (block: unknown) => pageInput.parse(page([block])).rows[0].columns[0].blocks[0];
const problems = (block: unknown) => {
  const parsed = pageInput.safeParse(page([block]));
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
};

describe("separator lines", () => {
  it("starts as a plain line and keeps its look within limits", () => {
    const line = newBlock("separator", () => "s");
    expect(line).toEqual({ id: "s", type: "separator" });
    expect(blockHasContent(line)).toBe(true);
    expect(blockText(line)).toBe("");
    expect(blockTextFields(line)).toEqual([]);
    const styled = { id: "s", type: "separator", line: "dashed", thickness: 4, color: "#ff0000", width: 50, position: "left" };
    expect(parse(styled)).toEqual(styled);
    expect(problems({ id: "s", type: "separator", thickness: 40 })).toEqual(["Keep a line at most 16 pixels thick."]);
    expect(problems({ id: "s", type: "separator", width: 5 })).toEqual(["Make a line at least 10 % of its column."]);
    expect(problems({ id: "s", type: "separator", line: "wavy" })).toHaveLength(1);
  });
});

describe("dual buttons", () => {
  it("shows once one of its buttons has text and an address, and translates both texts", () => {
    const pair = newBlock("dualButton", () => "d");
    expect(pair).toMatchObject({ first: { label: "", href: "" }, second: { variant: "outline" } });
    expect(blockHasContent(pair)).toBe(false);
    const ready = { ...pair, first: { label: "Handle nå", href: "/products" }, gap: 24, stackOnPhones: true, size: "lg" as const };
    expect(blockHasContent(ready)).toBe(true);
    expect(parse(ready)).toEqual(ready);
    expect(blockTextFields(ready as never).map((field) => [field.key, field.label])).toEqual([
      ["block.d.first.label", "First button's text"],
      ["block.d.second.label", "Second button's text"],
    ]);
    expect(problems({ ...ready, second: { label: "Les mer", href: "javascript:alert(1)" } })).toEqual([
      "A button's address must be https://…, a page like /about, mailto: or tel:.",
    ]);
    expect(problems({ ...ready, gap: 100 })).toEqual(["Keep the space between the buttons at 64 pixels or less."]);
  });
});

describe("accordions", () => {
  const accordion = {
    id: "a",
    type: "accordion",
    items: [
      { id: "i1", title: "Levering", body: doc("Vi sender innen to dager.") },
      { id: "i2", title: "", body: doc("Uten tittel.") },
    ],
    openFirst: true,
    single: true,
    look: "boxed",
  };

  it("keeps its sections, shows once one has a title, and gives their words to the page", () => {
    const fresh = newBlock("accordion", () => "x");
    expect(fresh).toMatchObject({ type: "accordion", items: [{ title: "" }] });
    expect(blockHasContent(fresh)).toBe(false);
    const parsed = parse(accordion);
    expect(parsed).toMatchObject({ openFirst: true, single: true, look: "boxed", items: [{ id: "i1", title: "Levering" }, { id: "i2" }] });
    expect(blockHasContent(parsed)).toBe(true);
    expect(blockText(parsed)).toBe("Levering Vi sender innen to dager. Uten tittel.");
  });

  it("refuses too many sections, a section's id twice and a title too long", () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ id: `i${i}`, title: "T", body: doc("x") }));
    expect(problems({ ...accordion, items: many })).toEqual(["A component holds at most 30 items."]);
    expect(problems({ ...accordion, items: [accordion.items[0], accordion.items[0]] })).toEqual(["Two items have the same id. Reload the page and try again."]);
    expect(problems({ ...accordion, items: [{ id: "i1", title: "x".repeat(201), body: doc("x") }] })).toEqual(["Keep a title under 200 characters."]);
  });

  it("translates each section's title and text by the section", () => {
    const fields = blockTextFields(parse(accordion));
    expect(fields.map((field) => [field.key, field.label])).toEqual([
      ["block.a.i1.title", "Section 1: title"],
      ["block.a.i1.body", "Section 1: text"],
      ["block.a.i2.title", "Section 2: title"],
      ["block.a.i2.body", "Section 2: text"],
    ]);
    const content = { ...pageInput.parse(page([accordion])), translations: { "sv-SE": { "block.a.i1.title": "Leverans", "block.a.i1.body": doc("Vi skickar inom två dagar.") } } };
    const swedish = localizePage(pageInput.parse(content), "sv-SE").rows[0].columns[0].blocks[0];
    expect(swedish).toMatchObject({ items: [{ title: "Leverans", body: doc("Vi skickar inom två dagar.") }, { title: "" }] });
  });
});

describe("tabs", () => {
  it("keeps its tabs and look, and translates each tab by the tab", () => {
    const tabs = {
      id: "t",
      type: "tabs",
      items: [
        { id: "a", title: "Beskrivelse", body: doc("En hvit kopp.") },
        { id: "b", title: "Mål", body: doc("8 cm høy.") },
      ],
      look: "pills",
      tabsAlign: "center",
    };
    expect(newBlock("tabs", () => "n")).toMatchObject({ type: "tabs", items: [{ title: "" }] });
    const parsed = parse(tabs);
    expect(parsed).toMatchObject({ look: "pills", tabsAlign: "center" });
    expect(blockText(parsed)).toBe("Beskrivelse En hvit kopp. Mål 8 cm høy.");
    expect(blockTextFields(parsed).map((field) => field.label)).toEqual(["Tab 1: title", "Tab 1: text", "Tab 2: title", "Tab 2: text"]);
    expect(problems({ ...tabs, look: "cards" })).toHaveLength(1);
  });
});

describe("FAQs", () => {
  const faq = {
    id: "f",
    type: "faq",
    items: [
      { id: "q1", title: "Hvor lang er leveringstiden?", body: doc("To til fire dager.") },
      { id: "q2", title: "Kan jeg returnere?", body: EMPTY_DOC },
    ],
  };

  it("shows only questions with an answer, and gives them to the page's words", () => {
    const parsed = parse(faq);
    expect(blockHasContent(parsed)).toBe(true);
    expect(blockHasContent(parse({ ...faq, items: [faq.items[1]] }))).toBe(false);
    expect(blockText(parsed)).toBe("Hvor lang er leveringstiden? To til fire dager.");
    expect(parse({ ...faq, structuredData: false })).toMatchObject({ structuredData: false });
  });

  it("translates each question and answer by name", () => {
    expect(blockTextFields(parse(faq)).map((field) => field.label)).toEqual(["Question 1", "Answer 1", "Question 2", "Answer 2"]);
  });

  it("is schema.org's FAQPage for search engines and AI assistants", () => {
    expect(faqJsonLd([{ question: "Hvor lang er leveringstiden?", answer: "To til fire dager." }])).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [{ "@type": "Question", name: "Hvor lang er leveringstiden?", acceptedAnswer: { "@type": "Answer", text: "To til fire dager." } }],
    });
  });
});

describe("videos", () => {
  const youtube = { id: "v", type: "video", source: "youtube", video: null, link: "https://youtu.be/dQw4w9WgXcQ", poster: null, title: "Slik lager vi koppene" };

  it("starts empty and shows once it has a video", () => {
    const fresh = newBlock("video", () => "n");
    expect(fresh).toMatchObject({ type: "video", source: "youtube", video: null, link: "" });
    expect(blockHasContent(fresh)).toBe(false);
    expect(blockHasContent(parse(youtube))).toBe(true);
    expect(blockHasContent(parse({ ...youtube, source: "upload" }))).toBe(false);
    expect(blockHasContent(parse({ ...youtube, source: "upload", video: { url: "https://example.com/film.mp4" } }))).toBe(true);
  });

  it("takes only a YouTube or Vimeo video's address", () => {
    expect(parse({ ...youtube, source: "vimeo", link: "https://vimeo.com/76979871" })).toMatchObject({ link: "https://vimeo.com/76979871" });
    expect(problems({ ...youtube, link: "https://example.com/film" })).toEqual(["Use the address of a video on YouTube or Vimeo, as its Share button gives it."]);
    expect(problems({ ...youtube, source: "vimeo" })).toHaveLength(1);
    expect(problems({ ...youtube, ratio: "2:1" })).toHaveLength(1);
  });

  it("gives its title to the page's words and to translation", () => {
    const parsed = parse(youtube);
    expect(blockText(parsed)).toBe("Slik lager vi koppene");
    expect(blockTextFields(parsed).map((field) => [field.key, field.label])).toEqual([["block.v.title", "Video title"]]);
  });
});

describe("HTML", () => {
  const html = { id: "h", type: "html", html: "<p>Hei</p>", title: "Påmelding" };

  it("starts empty and shows once it has HTML, with none of its words in the page's", () => {
    expect(newBlock("html", () => "n")).toEqual({ id: "n", type: "html", html: "", title: "" });
    expect(blockHasContent(parse({ ...html, html: "  " }))).toBe(false);
    const parsed = parse(html);
    expect(blockHasContent(parsed)).toBe(true);
    expect(blockText(parsed)).toBe("");
  });

  it("keeps a set height within limits, and the HTML under its length", () => {
    expect(parse({ ...html, height: 320, waitForClick: true })).toMatchObject({ height: 320, waitForClick: true });
    expect(problems({ ...html, height: 5 })).toEqual(["Make the HTML at least 20 pixels tall."]);
    expect(problems({ ...html, html: "x".repeat(50_001) })).toEqual(["Keep the HTML under 50,000 characters."]);
  });

  it("translates its title, never its code", () => {
    expect(blockTextFields(parse(html)).map((field) => [field.key, field.label])).toEqual([["block.h.title", "HTML title"]]);
  });
});

describe("testimonials", () => {
  const testimonials = {
    id: "t",
    type: "testimonials",
    items: [
      { id: "a", quote: "Den beste koppen jeg har hatt.", name: "Kari", role: "Kunde i Bergen", rating: 5, picture: null },
      { id: "b", quote: "", name: "Ola", role: "", picture: null },
    ],
    columns: 2,
    look: "quote",
  };

  it("shows those with words, and gives what they said to the page's words", () => {
    expect(newBlock("testimonials", () => "n")).toMatchObject({ type: "testimonials", items: [{ quote: "", name: "" }] });
    const parsed = parse(testimonials);
    expect(parsed).toMatchObject({ columns: 2, look: "quote" });
    expect(blockHasContent(parsed)).toBe(true);
    expect(blockHasContent(parse({ ...testimonials, items: [testimonials.items[1]] }))).toBe(false);
    expect(blockText(parsed)).toBe("Den beste koppen jeg har hatt. Kari");
  });

  it("keeps stars from 1 to 5 and up to four columns", () => {
    expect(problems({ ...testimonials, items: [{ ...testimonials.items[0], rating: 6 }] })).toEqual(["Give from 1 to 5 stars."]);
    expect(problems({ ...testimonials, columns: 5 })).toEqual(["Show testimonials in 1 to 4 columns."]);
  });

  it("translates what was said and who they are, never their name", () => {
    expect(blockTextFields(parse(testimonials)).map((field) => field.label)).toEqual([
      "Testimonial 1",
      "Testimonial 1: title or place",
      "Testimonial 2",
      "Testimonial 2: title or place",
    ]);
  });
});

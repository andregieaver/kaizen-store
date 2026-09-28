import { describe, expect, it } from "vitest";

import { cleanDocumentText, cutPassages, documentInput, documentType, pageKnowledgeText } from "./knowledge";
import { newPageContent } from "./page-content";

describe("knowledge documents (D81)", () => {
  it("knows the files it reads", () => {
    expect(documentType("Returns.PDF")).toBe("pdf");
    expect(documentType("guide.docx")).toBe("docx");
    expect(documentType("notes.md")).toBe("md");
    expect(documentType("sheet.xlsx")).toBeNull();
    expect(documentType("noextension")).toBeNull();
  });

  it("cleans text from files", () => {
    expect(cleanDocumentText("a\r\nb\u0000\n\n\n\nc   d \t e")).toBe("a\nb\n\nc d e");
  });

  it("needs a title and some text", () => {
    expect(documentInput.safeParse({ title: "Returns", content: "  \n " }).success).toBe(false);
    expect(documentInput.safeParse({ title: " ", content: "Text" }).success).toBe(false);
    expect(documentInput.parse({ title: "Returns", content: "30 days.\r\n" }).content).toBe("30 days.");
  });
});

describe("cutPassages", () => {
  it("keeps short text whole", () => {
    expect(cutPassages("One.\n\nTwo.")).toEqual(["One.\n\nTwo."]);
    expect(cutPassages("   ")).toEqual([]);
  });

  it("cuts at paragraphs, never past the limit, overlapping by a sentence", () => {
    const paragraph = (n: number) => `Paragraph ${n} starts here. ${"word ".repeat(30).trim()}. It ends with sentence ${n}.`;
    const text = Array.from({ length: 12 }, (_, i) => paragraph(i)).join("\n\n");
    const passages = cutPassages(text, 400);
    expect(passages.length).toBeGreaterThan(3);
    for (const passage of passages) expect(passage.length).toBeLessThanOrEqual(400);
    // Each passage after the first starts with the last sentence of the one before.
    expect(passages[1].startsWith(passages[0].match(/[^.!?\n]+[.!?]+\s*$/)![0].trim())).toBe(true);
    // Nothing is lost.
    for (let i = 0; i < 12; i++) expect(passages.some((p) => p.includes(`sentence ${i}.`))).toBe(true);
  });

  it("cuts long paragraphs at sentences and long sentences at spaces", () => {
    const sentences = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    for (const passage of cutPassages(sentences, 100)) expect(passage.length).toBeLessThanOrEqual(100);
    const word = "lorem ".repeat(100).trim();
    const cut = cutPassages(word, 120);
    for (const passage of cut) expect(passage.length).toBeLessThanOrEqual(120);
    expect(cut.join(" ").split(" ").length).toBe(100);
  });
});

describe("pageKnowledgeText", () => {
  it("reads every block's words in order, not its buttons", () => {
    const content = {
      ...newPageContent(),
      title: "About",
      rows: [
        {
          id: "r",
          type: "row" as const,
          layout: "1" as const,
          columns: [
            {
              id: "c",
              blocks: [
                { id: "h", type: "heading" as const, text: "Who we are", level: 2 as const },
                { id: "b", type: "button" as const, label: "Contact", href: "/contact" },
                { id: "i", type: "image" as const, image: null, caption: "Our shop in Bergen" },
              ],
            },
          ],
        },
      ],
    };
    expect(pageKnowledgeText(content)).toBe("Who we are\n\nOur shop in Bergen");
  });
});

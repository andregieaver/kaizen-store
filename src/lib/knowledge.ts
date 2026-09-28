import { z } from "zod";

import { blockText, type PageContent } from "./page-content";

/**
 * The chat agent's knowledge (D81), the pure parts: a site's pages,
 * articles and knowledge-base documents are cut into passages of a few
 * paragraphs, found by keyword and by meaning when a visitor asks.
 */

/** A passage's length: long enough to hold an answer, short enough to find it. */
export const PASSAGE_MAX = 1200;
export const DOCUMENT_MAX = 200_000;
export const DOCUMENT_TITLE_MAX = 200;
/** Files the knowledge base reads, by extension. */
export const DOCUMENT_TYPES = { txt: "Text", md: "Markdown", pdf: "PDF", docx: "Word" } as const;
export type DocumentType = keyof typeof DOCUMENT_TYPES;
/** Server actions take at most 4 MB (next.config). */
export const DOCUMENT_FILE_MAX = 4 * 1024 * 1024;

/** A file's type by its name, or null for one the knowledge base does not read. */
export function documentType(fileName: string): DocumentType | null {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  return extension in DOCUMENT_TYPES ? (extension as DocumentType) : null;
}

/** Text as read from a file or typed: one kind of line break, no runs of blank lines or spaces, no control characters. */
export function cleanDocumentText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    // Control characters from PDFs and Word files.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A document typed in or read from a file, as saved. */
export const documentInput = z.object({
  title: z.string().trim().min(1, "Give the document a title.").max(DOCUMENT_TITLE_MAX, `Keep the title under ${DOCUMENT_TITLE_MAX} characters.`),
  content: z
    .string()
    .transform(cleanDocumentText)
    .pipe(
      z
        .string()
        .min(1, "The document has no text. A scanned PDF has pictures of text only; paste its text instead.")
        .max(DOCUMENT_MAX, `A document holds at most ${DOCUMENT_MAX.toLocaleString("en-GB")} characters. Split it in two.`),
    ),
});

/**
 * Cuts text into passages of at most `max` characters, at paragraph
 * breaks where it can, else at the end of a sentence, else at a space;
 * each passage after the first starts with the last sentence of the one
 * before, so an answer across the cut is still found whole.
 */
export function cutPassages(text: string, max = PASSAGE_MAX): string[] {
  const clean = cleanDocumentText(text);
  if (!clean) return [];
  // Pieces no longer than `max`: paragraphs, and long ones cut into sentences, and long sentences at spaces.
  const pieces: string[] = [];
  for (const paragraph of clean.split(/\n{2,}/)) {
    if (paragraph.length <= max) {
      pieces.push(paragraph);
      continue;
    }
    for (const sentence of paragraph.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g) ?? [paragraph]) {
      let rest = sentence.trim();
      while (rest.length > max) {
        const cut = rest.lastIndexOf(" ", max);
        const at = cut > max / 2 ? cut : max;
        pieces.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      if (rest) pieces.push(rest);
    }
  }
  const passages: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const next = current ? `${current}\n\n${piece}` : piece;
    if (next.length <= max) {
      current = next;
      continue;
    }
    passages.push(current);
    const last = current.match(/[^.!?\n]+[.!?]+\s*$/)?.[0].trim() ?? "";
    current = last && last.length + piece.length + 2 <= max && last !== piece ? `${last}\n\n${piece}` : piece;
  }
  if (current) passages.push(current);
  return passages;
}

/** A page's or article's words for the agent: its title, then every block's text in order. */
export function pageKnowledgeText(content: Pick<PageContent, "title" | "rows">): string {
  const blocks = content.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks.map(blockText)));
  return cleanDocumentText(blocks.filter((text) => text.trim()).join("\n\n"));
}

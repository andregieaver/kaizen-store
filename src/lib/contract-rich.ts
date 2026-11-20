import { cleanRichText, type BlockNode, type InlineNode, type Mark, type RichTextDoc, type TextNode } from "./rich-text-doc";

/**
 * A contract's formatted words (D695, rich text in drafts and templates), pure: what a paragraph's or a clause's `doc` may hold, its words
 * as plain text (the block's `text`, which fields, the AI manager's tools and search read), a stored plain text as a document, and a
 * document with its fields filled in. A contract takes paragraphs, bulleted and numbered lists, line breaks, bold, italic and underline:
 * no heading inside a block (a heading is its own block), no link (the PDF renderer refuses every request), no colour and no text style.
 * Nothing here is HTML: the views draw the nodes as elements.
 */

/**
 * The fields a template may name, as `{key}` in its words (D695). Their values come from the deal, its person and company, the store and
 * today. Kept here, without the schema (`contract-fields.ts` re-exports them), so a page that only lists them carries no zod.
 */
export const CONTRACT_FIELDS = [
  "customer.name",
  "customer.email",
  "customer.phone",
  "customer.address",
  "company.name",
  "company.org_number",
  "company.address",
  "store.name",
  "store.org_number",
  "store.address",
  "store.email",
  "deal.title",
  "deal.owner",
  "deal.value",
  "contract.title",
  "contract.date",
  "contract.expires",
] as const;
export type ContractField = (typeof CONTRACT_FIELDS)[number];

type ContractMark = Extract<Mark, { type: "bold" | "italic" | "underline" }>;
const keepsMark = (mark: Mark): mark is ContractMark => mark.type === "bold" || mark.type === "italic" || mark.type === "underline";

function inlineOnly(nodes: InlineNode[] = []): InlineNode[] {
  const out: InlineNode[] = [];
  for (const node of nodes) {
    if (node.type === "hardBreak") out.push(node);
    else if (node.text) {
      const marks = (node.marks ?? []).filter(keepsMark);
      out.push(marks.length ? { type: "text", text: node.text, marks } : { type: "text", text: node.text });
    }
  }
  return out;
}

const paragraphOf = (content: InlineNode[]): BlockNode => (content.length ? { type: "paragraph", content } : { type: "paragraph" });

/** A block of the cleaned document as a contract takes it: a heading becomes a paragraph, a quote its own paragraphs, a line nothing. */
function contractBlocks(node: BlockNode): BlockNode[] {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return [paragraphOf(inlineOnly(node.content))];
    case "bulletList":
    case "orderedList": {
      const content = node.content.map((item) => ({ type: "listItem" as const, content: item.content.flatMap(contractBlocks) }));
      if (node.type === "bulletList") return [{ type: "bulletList", content }];
      const start = node.attrs?.start;
      return [typeof start === "number" && start !== 1 ? { type: "orderedList", attrs: { start }, content } : { type: "orderedList", content }];
    }
    case "blockquote":
      return node.content.flatMap(contractBlocks);
    case "horizontalRule":
      return [];
  }
}

/** A formatted block's document as stored or typed: checked as any rich text (`cleanRichText()`), then cut to what a contract takes. */
export function contractDoc(raw: unknown): { ok: true; doc: RichTextDoc } | { ok: false } {
  const cleaned = cleanRichText(raw);
  if (!cleaned.ok) return { ok: false };
  const content = cleaned.doc.content.flatMap(contractBlocks);
  return { ok: true, doc: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] } };
}

const inlineText = (nodes: InlineNode[] = []) => nodes.map((node) => (node.type === "text" ? node.text : "\n")).join("");

/**
 * The document's words as plain text, the block's `text`: paragraphs apart by an empty line, a line break as a new line, a bulleted item
 * after "- " and a numbered one after its number, so the words read as they look.
 */
export function contractDocText(doc: RichTextDoc): string {
  return textsOf(doc.content)
    .map((part) => part.replace(/\s+$/, ""))
    .filter(Boolean)
    .join("\n\n");
}

/** Each block's words: a list's items one per line, an item's own further lines indented under its marker. */
function textsOf(nodes: BlockNode[]): string[] {
  return nodes.flatMap((node): string[] => {
    switch (node.type) {
      case "paragraph":
      case "heading":
        return [inlineText(node.content)];
      case "bulletList":
      case "orderedList":
        return [
          node.content
            .map((item, i) => {
              const marker = node.type === "bulletList" ? "- " : `${(node.attrs?.start ?? 1) + i}. `;
              const inner = textsOf(item.content).filter((part) => part.trim()).join("\n");
              return marker + inner.split("\n").join("\n" + " ".repeat(marker.length));
            })
            .join("\n"),
        ];
      case "blockquote":
        return textsOf(node.content);
      case "horizontalRule":
        return [];
    }
  });
}

/** A plain text as a document, for a block written before formatting: an empty line starts a paragraph, a single new line is a line break. */
export function docFromText(text: string): RichTextDoc {
  const paragraphs = text.split(/\n[ \t]*\n/).filter((part) => part.trim());
  if (!paragraphs.length) return { type: "doc", content: [{ type: "paragraph" }] };
  return {
    type: "doc",
    content: paragraphs.map((part) => {
      const content: InlineNode[] = [];
      part.split("\n").forEach((line, i) => {
        if (i > 0) content.push({ type: "hardBreak" });
        if (line) content.push({ type: "text", text: line });
      });
      return paragraphOf(content);
    }),
  };
}

/**
 * Text runs filled in (`replace` is the contract's `{key}` filling, `fillContract()`): the runs of a paragraph between line breaks are read
 * as one text, so a field part bold and part not is still a field; its value takes the marks of where the field starts.
 */
function fillRun(run: TextNode[], replace: (text: string) => string, find: RegExp): TextNode[] {
  const whole = run.map((node) => node.text).join("");
  const matches = [...whole.matchAll(find)].map((m) => ({ start: m.index, end: m.index + m[0].length, value: replace(m[0]) }));
  if (!matches.length) return run;
  const out: TextNode[] = [];
  let offset = 0;
  for (const node of run) {
    const from = offset;
    const to = offset + node.text.length;
    offset = to;
    let text = "";
    let at = from;
    for (const match of matches) {
      if (match.end <= at || match.start >= to) continue;
      if (match.start >= at) {
        text += whole.slice(at, match.start) + match.value;
      }
      at = Math.min(match.end, to);
    }
    text += whole.slice(at, to);
    if (text) out.push(node.marks ? { type: "text", text, marks: node.marks } : { type: "text", text });
  }
  return out;
}

function fillInline(nodes: InlineNode[] | undefined, replace: (text: string) => string, find: RegExp): InlineNode[] | undefined {
  if (!nodes) return nodes;
  const out: InlineNode[] = [];
  let run: TextNode[] = [];
  const flush = () => {
    out.push(...fillRun(run, replace, find));
    run = [];
  };
  for (const node of nodes) {
    if (node.type === "text") run.push(node);
    else {
      flush();
      out.push(node);
    }
  }
  flush();
  return out;
}

/** The document with every field in its words filled in by `replace` (given each `{key}` as written, it answers the words to put there). */
export function fillContractDoc(doc: RichTextDoc, find: RegExp, replace: (field: string) => string): RichTextDoc {
  const walk = (node: BlockNode): BlockNode => {
    switch (node.type) {
      case "paragraph":
        return paragraphOf(fillInline(node.content, replace, find) ?? []);
      case "heading":
        return { ...node, content: fillInline(node.content, replace, find) };
      case "bulletList":
      case "orderedList":
        return { ...node, content: node.content.map((item) => ({ ...item, content: item.content.map(walk) })) };
      case "blockquote":
        return { ...node, content: node.content.map(walk) };
      case "horizontalRule":
        return node;
    }
  };
  return { type: "doc", content: doc.content.map(walk) };
}

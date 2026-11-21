import { describe, expect, it } from "vitest";

import { fillContract, type ContractBlock } from "./contract-fields";
import { parseBlocks } from "./contract-fields-schema";
import { contractDoc, contractDocText, docFromText, fillContractDoc } from "./contract-rich";
import type { RichTextDoc } from "./rich-text-doc";

const doc = (...content: RichTextDoc["content"]): RichTextDoc => ({ type: "doc", content });

const formatted = doc(
  { type: "paragraph", content: [{ type: "text", text: "Betaling til " }, { type: "text", text: "{store.name}", marks: [{ type: "bold" }] }, { type: "text", text: ":" }] },
  {
    type: "orderedList",
    content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "30 dager" }] }] },
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Renter", marks: [{ type: "italic" }] }] }] },
    ],
  },
  { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Faktura på e-post" }] }] }] },
);

describe("a contract's formatted words", () => {
  it("keep paragraphs, lists, bold, italic and underline, and nothing a contract does not take", () => {
    const raw = doc(
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Tittel" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Se ", marks: [{ type: "underline" }] },
          { type: "text", text: "her", marks: [{ type: "link", attrs: { href: "https://example.com" } }, { type: "textStyle", attrs: { color: "#ff0000" } }] },
        ],
      },
      { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Sitat" }] }] },
      { type: "horizontalRule" },
    );
    expect(contractDoc(raw)).toEqual({
      ok: true,
      doc: doc(
        { type: "paragraph", content: [{ type: "text", text: "Tittel" }] },
        { type: "paragraph", content: [{ type: "text", text: "Se ", marks: [{ type: "underline" }] }, { type: "text", text: "her" }] },
        { type: "paragraph", content: [{ type: "text", text: "Sitat" }] },
      ),
    });
    expect(contractDoc({ type: "doc", content: [{ type: "script" }] })).toEqual({ ok: false });
    expect(contractDoc("<p>x</p>")).toEqual({ ok: false });
  });

  it("read as plain text the way they look", () => {
    expect(contractDocText(formatted)).toBe("Betaling til {store.name}:\n\n1. 30 dager\n2. Renter\n\n- Faktura på e-post");
  });

  it("start from a plain text written before formatting, paragraph by paragraph and line by line", () => {
    const made = docFromText("Første avsnitt\nny linje\n\nAndre avsnitt");
    expect(made).toEqual(
      doc(
        { type: "paragraph", content: [{ type: "text", text: "Første avsnitt" }, { type: "hardBreak" }, { type: "text", text: "ny linje" }] },
        { type: "paragraph", content: [{ type: "text", text: "Andre avsnitt" }] },
      ),
    );
    expect(contractDocText(made)).toBe("Første avsnitt\nny linje\n\nAndre avsnitt");
    expect(docFromText("")).toEqual(doc({ type: "paragraph" }));
  });

  it("fill a field that is part bold and part not, its value taking the marks where it starts", () => {
    const split = doc({
      type: "paragraph",
      content: [{ type: "text", text: "Hei {customer" }, { type: "text", text: ".name}!", marks: [{ type: "bold" }] }],
    });
    expect(fillContractDoc(split, /\{([a-z_]+\.[a-z_]+)\}/g, () => "Kari")).toEqual(
      doc({ type: "paragraph", content: [{ type: "text", text: "Hei Kari" }, { type: "text", text: "!", marks: [{ type: "bold" }] }] }),
    );
  });
});

describe("a formatted block in a contract", () => {
  const block: ContractBlock = { type: "clause", id: "pay", title: "Betaling", text: "anything sent beside it", doc: formatted, optional: false, included: true };

  it("takes its text from its document, never as typed", () => {
    const parsed = parseBlocks([block, { type: "signatures" }]);
    expect(parsed.ok && parsed.blocks[0]).toMatchObject({ text: contractDocText(formatted), doc: formatted });
    expect(parseBlocks([{ type: "paragraph", text: "", doc: { type: "doc", content: [{ type: "image" }] } }])).toEqual({ ok: false, problems: [{ kind: "shape", at: 0 }] });
  });

  it("reports a field in its document that is not on the list", () => {
    const unknown = doc({ type: "paragraph", content: [{ type: "text", text: "{customer.shoe_size}", marks: [{ type: "bold" }] }] });
    expect(parseBlocks([{ type: "paragraph", text: "", doc: unknown }])).toEqual({ ok: false, problems: [{ kind: "unknown_field", key: "customer.shoe_size" }] });
  });

  it("is filled in as its text is, and a field with no value stops the send", () => {
    const parsed = parseBlocks([block, { type: "signatures" }]);
    if (!parsed.ok) throw new Error("not parsed");
    const parties = { store: { name: "Butikken AS", orgNumber: null, address: null }, customer: { name: "Kunde AS", orgNumber: null, address: null } };
    const input = { title: "Avtale", language: "nb", parties, signers: [{ role: "store" as const, name: "S" }, { role: "customer" as const, name: "K" }], blocks: parsed.blocks };
    const filled = fillContract(input, { values: { "store.name": "Butikken" }, quote: null });
    expect(filled.ok).toBe(true);
    const clause = filled.snapshot.blocks[0];
    expect(clause.type === "clause" && clause.text).toBe("Betaling til Butikken:\n\n1. 30 dager\n2. Renter\n\n- Faktura på e-post");
    expect(clause.type === "clause" && clause.doc?.content[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Betaling til " }, { type: "text", text: "Butikken", marks: [{ type: "bold" }] }, { type: "text", text: ":" }],
    });
    expect(fillContract(input, { values: {}, quote: null })).toMatchObject({ ok: false, problems: [{ kind: "missing_field", key: "store.name" }] });
  });
});

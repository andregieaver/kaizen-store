import { describe, expect, it } from "vitest";

import { CONTRACT_FIELDS, draftBlocks, fieldsIn, fillContract, parseBlocks, type ContractBlock, type ContractFacts } from "./contract-fields";

const blocks: ContractBlock[] = [
  { type: "heading", text: "Avtale med {company.name}" },
  { type: "paragraph", text: "Mellom {store.name} og {customer.name}, {contract.date}." },
  { type: "clause", id: "payment", title: "Betaling", text: "30 dager.", optional: false, included: true },
  { type: "clause", id: "nda", title: "Taushet", text: "{customer.name} holder tett.", optional: true, included: false },
  { type: "quote_lines" },
  { type: "signatures" },
];

const facts: ContractFacts = {
  values: { "company.name": "Kunde AS", "store.name": "Butikken", "customer.name": "Kari Nordmann", "contract.date": "16.11.2026" },
  quote: { lines: [{ name: "Oppsett", quantity: 1, unitPrice: "10 000,00 kr", total: "10 000,00 kr" }], total: "12 500,00 kr" },
};

describe("a contract's blocks", () => {
  it("accept the five kinds of block, with fields only from the list and each clause once", () => {
    expect(parseBlocks(blocks)).toEqual({ ok: true, blocks });
    expect(parseBlocks([{ type: "paragraph", text: "Hei {customer.shoe_size}" }])).toEqual({
      ok: false,
      problems: [{ kind: "unknown_field", key: "customer.shoe_size" }],
    });
    expect(parseBlocks([blocks[2], blocks[2]])).toEqual({ ok: false, problems: [{ kind: "clause_twice", id: "payment" }] });
    expect(parseBlocks([{ type: "html", text: "<b>x</b>" }])).toEqual({ ok: false, problems: [{ kind: "shape", at: 0 }] });
    expect(parseBlocks("not a list")).toMatchObject({ ok: false });
  });

  it("name their fields once each, leaving out a clause that is not included", () => {
    expect(fieldsIn(blocks)).toEqual(["company.name", "store.name", "customer.name", "contract.date"]);
    expect(fieldsIn(draftBlocks(blocks))).toContain("customer.name");
    for (const key of fieldsIn(blocks)) expect(CONTRACT_FIELDS).toContain(key);
  });

  it("start a draft with every clause included", () => {
    expect(draftBlocks(blocks).filter((b) => b.type === "clause").every((b) => b.type === "clause" && b.included)).toBe(true);
  });
});

describe("filling a contract in", () => {
  it("fills every field, drops a clause left out, and takes the quote's lines", () => {
    const result = fillContract({ title: "Avtale", language: "nb", blocks }, facts);
    expect(result.ok).toBe(true);
    expect(result.snapshot.blocks).toEqual([
      { type: "heading", text: "Avtale med Kunde AS" },
      { type: "paragraph", text: "Mellom Butikken og Kari Nordmann, 16.11.2026." },
      { type: "clause", id: "payment", title: "Betaling", text: "30 dager." },
      { type: "quote_lines", lines: facts.quote?.lines, total: "12 500,00 kr" },
      { type: "signatures" },
    ]);
  });

  it("keeps a required clause even when marked left out", () => {
    const required: ContractBlock[] = [{ type: "clause", id: "law", title: "Lov", text: "Norsk rett.", optional: false, included: false }, { type: "signatures" }];
    expect(fillContract({ title: "A", language: "nb", blocks: required }, facts).snapshot.blocks[0]).toEqual({ type: "clause", id: "law", title: "Lov", text: "Norsk rett." });
  });

  it("says which fields have no value, and never sends a blank or a brace as one", () => {
    const result = fillContract({ title: "A", language: "nb", blocks }, { values: { ...facts.values, "company.name": "  " }, quote: facts.quote });
    expect(result).toMatchObject({ ok: false, problems: [{ kind: "missing_field", key: "company.name" }] });
  });

  it("needs a quote for a quote block, something to sign and a place to sign it", () => {
    expect(fillContract({ title: "A", language: "nb", blocks }, { ...facts, quote: null })).toMatchObject({ ok: false, problems: [{ kind: "no_quote" }] });
    expect(fillContract({ title: "A", language: "nb", blocks: [blocks[1]] }, facts)).toMatchObject({ ok: false, problems: [{ kind: "no_signatures" }] });
    expect(fillContract({ title: "A", language: "nb", blocks: [{ type: "signatures" }] }, facts)).toMatchObject({ ok: false, problems: [{ kind: "empty" }] });
  });

  it("leaves a field's value as text: markup stays the words it is", () => {
    const result = fillContract({ title: "A", language: "nb", blocks: [blocks[1], blocks[5]] }, { values: { ...facts.values, "customer.name": "<script>x</script>" }, quote: null });
    expect(result.snapshot.blocks[0]).toEqual({ type: "paragraph", text: "Mellom Butikken og <script>x</script>, 16.11.2026." });
  });
});

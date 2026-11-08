import { describe, expect, it } from "vitest";

import { documentFits, documentWords, inboxMatches, type InboxDocument } from "./books-inbox";
import type { RecurringCost, RecurringLine } from "./recurring-costs";

const claude: RecurringCost = {
  id: "c1",
  name: "Claude Max",
  matchText: "ANTHROPIC",
  kind: "software",
  vatRate: 0,
  abroad: true,
  every: "month",
  amountMinor: 220_000,
  startedOn: "2026-01-01",
  endedOn: null,
};

const line = (id: string, day: string, text: string, amountMinor = -220_500): RecurringLine => ({ id, day, amountMinor, text, counterparty: null, reference: null });
const doc = (id: string, receivedOn: string, from: string, subject: string | null, fileName = "Receipt-2291-4410.pdf"): InboxDocument => ({ id, receivedOn, from, subject, fileName });

describe("the books' inbox, its documents matched to bank lines (D504)", () => {
  it("knows a document by its sender, subject and file name, as plain words", () => {
    expect(documentWords(doc("d1", "2026-11-03", "Anthropic, PBC <invoice+statements@mail.anthropic.com>", "Your receipt from Anthropic, PBC #2291-4410"))).toBe(
      " anthropic pbc invoice statements mail anthropic com your receipt from anthropic pbc 2291 4410 receipt 2291 4410 pdf ",
    );
  });

  it("fits a document to a line by the line's subscription, else by its charge's first word, within ten days", () => {
    const receipt = doc("d1", "2026-11-03", "invoice+statements@mail.anthropic.com", "Your receipt from Anthropic, PBC");
    expect(documentFits(receipt, line("l1", "2026-11-04", "Varekjøp *4321 ANTHROPIC USD 200,00"), [claude])).toBe(true);
    expect(documentFits(receipt, line("l1", "2026-11-04", "Varekjøp *4321 ANTHROPIC USD 200,00"), [])).toBe(true);
    // Too far apart, money in, or another seller.
    expect(documentFits(receipt, line("l1", "2026-11-20", "Varekjøp ANTHROPIC"), [claude])).toBe(false);
    expect(documentFits(receipt, line("l1", "2026-11-04", "ANTHROPIC refund", 220_500), [claude])).toBe(false);
    expect(documentFits(receipt, line("l1", "2026-11-04", "Varekjøp *4321 VERCEL INC USD 20,00"), [claude])).toBe(false);
    // A charge's word shorter than four letters is too weak to go by.
    expect(documentFits(doc("d2", "2026-11-03", "billing@aws.com", "AWS invoice"), line("l2", "2026-11-04", "Varekjøp AWS EMEA"), [])).toBe(false);
  });

  it("gives each line its nearest document and each document one line", () => {
    const docs = [
      doc("oct", "2026-10-03", "invoice+statements@mail.anthropic.com", "Your receipt from Anthropic"),
      doc("nov", "2026-11-03", "invoice+statements@mail.anthropic.com", "Your receipt from Anthropic"),
      doc("vercel", "2026-11-01", "Vercel <invoices@vercel.com>", "Vercel Invoice"),
    ];
    const lines = [
      line("l-oct", "2026-10-04", "Varekjøp *4321 ANTHROPIC USD 200,00"),
      line("l-nov", "2026-11-05", "Varekjøp *4321 ANTHROPIC USD 200,00"),
      line("l-ver", "2026-11-02", "Varekjøp *4321 VERCEL INC USD 20,00", -21_400),
      line("l-rema", "2026-11-02", "Rema 1000 Tøyen", -34_000),
    ];
    expect(Object.fromEntries(inboxMatches(docs, lines, [claude]))).toEqual({ "l-oct": "oct", "l-nov": "nov", "l-ver": "vercel" });
    // One receipt for two charges: only the nearer line has it.
    expect(Object.fromEntries(inboxMatches([docs[1]], lines, [claude]))).toEqual({ "l-nov": "nov" });
  });
});

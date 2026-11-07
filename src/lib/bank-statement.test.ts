import { describe, expect, it } from "vitest";

import { bankAmount, bankDay, matchBankLines, readStatement } from "./bank-statement";

const bytes = (text: string) => new TextEncoder().encode(text);

/** A camt.053 as banks write it (version 001.02, no prefix): a payout from Stripe, a payment with a KID, a card payment, a pending one. */
const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>1</MsgId><CreDtTm>2027-02-01T06:00:00</CreDtTm></GrpHdr>
    <Stmt>
      <Id>S1</Id>
      <Acct><Id><IBAN>NO9386011117947</IBAN></Id><Ccy>NOK</Ccy></Acct>
      <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="NOK">10000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2027-01-01</Dt></Dt></Bal>
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="NOK">11 465.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2027-01-31</Dt></Dt></Bal>
      <Ntry>
        <Amt Ccy="NOK">965.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
        <BookgDt><Dt>2027-01-18</Dt></BookgDt><ValDt><Dt>2027-01-18</Dt></ValDt><AcctSvcrRef>DNB-0001</AcctSvcrRef>
        <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>STRIPE PAYMENTS EUROPE</Nm></Dbtr></RltdPties><RmtInf><Ustrd>STRIPE PAYOUT</Ustrd></RmtInf></TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="NOK">1500.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>2027-01-20</Dt></BookgDt><AcctSvcrRef>DNB-0002</AcctSvcrRef>
        <NtryDtls><TxDtls><Refs><EndToEndId>E2E-1</EndToEndId></Refs><RltdPties><Dbtr><Nm>Acme AS</Nm></Dbtr></RltdPties>
          <RmtInf><Strd><CdtrRefInf><Ref>0012345678903</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="NOK">1000,00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts>
        <BookgDt><DtTm>2027-01-25T10:00:00</DtTm></BookgDt>
        <AddtlNtryInf>Varekjøp Kontorbutikken</AddtlNtryInf>
      </Ntry>
      <Ntry>
        <Amt Ccy="NOK">50.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2027-01-31</Dt></BookgDt>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

describe("a bank's statement read from its file (B4)", () => {
  it("reads a camt.053's booked entries, its account and its balances, leaving a pending one out", () => {
    const read = readStatement(bytes(CAMT), "NOK");
    if (!read.ok) throw new Error(read.problem);
    const s = read.statement;
    expect({ format: s.format, account: s.account, currency: s.currency, fromDay: s.fromDay, toDay: s.toDay, opening: s.openingMinor, closing: s.closingMinor }).toEqual({
      format: "camt053",
      account: "NO9386011117947",
      currency: "NOK",
      fromDay: "2027-01-01",
      toDay: "2027-01-31",
      opening: 1_000_000,
      closing: 1_146_500,
    });
    expect(s.lines).toEqual([
      { key: "ref:DNB-0001", bookedOn: "2027-01-18", amountMinor: 96_500, currency: "NOK", text: "STRIPE PAYOUT", reference: null, counterparty: "STRIPE PAYMENTS EUROPE" },
      { key: "ref:DNB-0002", bookedOn: "2027-01-20", amountMinor: 150_000, currency: "NOK", text: "", reference: "0012345678903", counterparty: "Acme AS" },
      { key: "line:2027-01-25|-100000|Varekjøp Kontorbutikken|1", bookedOn: "2027-01-25", amountMinor: -100_000, currency: "NOK", text: "Varekjøp Kontorbutikken", reference: null, counterparty: null },
    ]);
  });

  it("reads a netbank's CSV by its columns' names: DNB's in and out apart, another's one amount, with a currency or the books'", () => {
    const dnb = `"Dato";"Forklaring";"Rentedato";"Ut fra konto";"Inn på konto"\n"18.01.2027";"STRIPE PAYOUT";"18.01.2027";"";"965,00"\n"25.01.2027";"Varekjøp Kontorbutikken";"25.01.2027";"1 000,00";""\n"25.01.2027";"Varekjøp Kontorbutikken";"25.01.2027";"1 000,00";""\n`;
    const read = readStatement(bytes(dnb), "NOK");
    if (!read.ok) throw new Error(read.problem);
    expect(read.statement.format).toBe("csv");
    expect(read.statement.lines.map((l) => [l.bookedOn, l.amountMinor, l.text, l.key])).toEqual([
      ["2027-01-18", 96_500, "STRIPE PAYOUT", "line:2027-01-18|96500|STRIPE PAYOUT|1"],
      ["2027-01-25", -100_000, "Varekjøp Kontorbutikken", "line:2027-01-25|-100000|Varekjøp Kontorbutikken|1"],
      // The same purchase twice the same day: two lines, told apart by their count.
      ["2027-01-25", -100_000, "Varekjøp Kontorbutikken", "line:2027-01-25|-100000|Varekjøp Kontorbutikken|2"],
    ]);
    expect([read.statement.fromDay, read.statement.toDay]).toEqual(["2027-01-18", "2027-01-25"]);
    // The same file read again gives the same keys, so a second upload adds nothing.
    const again = readStatement(bytes(dnb), "NOK");
    expect(again.ok && again.statement.lines.map((l) => l.key)).toEqual(read.statement.lines.map((l) => l.key));

    const nordea = `Bokføringsdato;Beløp;Avsender;Mottaker;Navn;Tittel;Valuta\n2027-01-20;1500,00;;;Acme AS;Faktura 1042;NOK\n2027-01-21;-249,50;;;Telenor;Mobil;NOK\n`;
    const other = readStatement(bytes(nordea), "NOK");
    if (!other.ok) throw new Error(other.problem);
    expect(other.statement.lines.map((l) => [l.amountMinor, l.text, l.counterparty])).toEqual([
      [150_000, "Faktura 1042", "Acme AS"],
      [-24_950, "Mobil", "Telenor"],
    ]);
  });

  it("refuses a file it cannot read whole: not a statement, a line it cannot read, two accounts, no lines", () => {
    expect(readStatement(bytes("hello;world\n1;2\n"), "NOK")).toEqual({ ok: false, problem: "format" });
    expect(readStatement(bytes(`Dato;Beløp\n18.01.2027;abc\n`), "NOK")).toEqual({ ok: false, problem: "unreadable" });
    expect(readStatement(bytes(`Dato;Beløp\n`), "NOK")).toEqual({ ok: false, problem: "empty" });
    expect(readStatement(bytes("<Document><Nothing/></Document>"), "NOK")).toEqual({ ok: false, problem: "format" });
    expect(readStatement(bytes("<Document><Stmt>"), "NOK")).toEqual({ ok: false, problem: "unreadable" });
    // A DTD is never read, so a file cannot reach outside itself.
    expect(readStatement(bytes('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><Document>&e;</Document>'), "NOK")).toEqual({ ok: false, problem: "unreadable" });
    const two = CAMT.replace("</Stmt>", "</Stmt><Stmt><Acct><Id><IBAN>NO0000000000000</IBAN></Id><Ccy>NOK</Ccy></Acct></Stmt>");
    expect(readStatement(bytes(two), "NOK")).toEqual({ ok: false, problem: "mixed" });
  });

  it("reads the amounts and days banks write", () => {
    expect(bankAmount("1234.56", "NOK")).toBe(123_456);
    expect(bankAmount("1 234,56", "NOK")).toBe(123_456);
    expect(bankAmount("-1.234,56", "NOK")).toBe(-123_456);
    expect(bankAmount("1,234.56", "EUR")).toBe(123_456);
    expect(bankAmount("1.000", "NOK")).toBe(100_000);
    expect(bankAmount("12", "NOK")).toBe(1_200);
    expect(bankAmount("12,5", "NOK")).toBe(1_250);
    expect(bankAmount("1,2,3", "NOK")).toBeNull();
    expect(bankAmount("abc", "NOK")).toBeNull();
    expect(bankDay("31.01.2027")).toBe("2027-01-31");
    expect(bankDay("31/01/27")).toBe("2027-01-31");
    expect(bankDay("2027-01-31T23:59:00")).toBe("2027-01-31");
    expect(bankDay("31.02.2027")).toBeNull();
  });
});

describe("bank lines matched to the books (B4)", () => {
  it("pairs each bank line with a line of the books of the same amount, the nearest day first, one to one, at most four days apart", () => {
    const bank = [
      { id: "b1", day: "2027-01-18", amountMinor: 96_500 },
      { id: "b2", day: "2027-01-20", amountMinor: 150_000 },
      { id: "b3", day: "2027-01-21", amountMinor: 150_000 },
      { id: "b4", day: "2027-01-25", amountMinor: -100_000 },
    ];
    const books = [
      { entryId: "e1", day: "2027-01-16", amountMinor: 96_500 },
      { entryId: "e2", day: "2027-01-21", amountMinor: 150_000 },
      { entryId: "e3", day: "2027-01-10", amountMinor: 150_000 },
      { entryId: "e4", day: "2027-01-19", amountMinor: 150_000 },
    ];
    expect(matchBankLines(bank, books)).toEqual([
      { bankId: "b3", entryId: "e2" },
      { bankId: "b2", entryId: "e4" },
      { bankId: "b1", entryId: "e1" },
    ]);
    // Too far apart, or not the same øre: no match.
    expect(matchBankLines([{ id: "b", day: "2027-01-20", amountMinor: 100 }], [{ entryId: "e", day: "2027-01-25", amountMinor: 100 }])).toEqual([]);
    expect(matchBankLines([{ id: "b", day: "2027-01-20", amountMinor: 100 }], [{ entryId: "e", day: "2027-01-20", amountMinor: 101 }])).toEqual([]);
  });
});

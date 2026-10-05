import { describe, expect, it } from "vitest";

import { toCsv } from "./dac7";
import {
  DIALECTS,
  FORMULA_TRIGGERS,
  decodeCsv,
  detectDelimiter,
  escapeText,
  parseCsv,
  parseInteger,
  recordsOf,
  startsLikeFormula,
  unescapeText,
  writeCsv,
  type Cell,
  type DialectId,
} from "./csv";

/** A small seeded generator, so a failure is repeatable. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = ["a", "b", "Z", "0", "9", " ", "æ", "ø", "å", "é", "é", "😀", ",", ";", "\t", "\r", "\n", '"', "'", "=", "+", "-", "@", "\\", "|", "/", "<", ">", "&", "#", "%", " ", "​"];

function randomText(next: () => number): string {
  const length = Math.floor(next() * 8);
  let out = "";
  // Often start with a trigger, a quote, or a quote and then a trigger: the cases the escape is exact for.
  const lead = next();
  if (lead < 0.25) out += FORMULA_TRIGGERS[Math.floor(next() * FORMULA_TRIGGERS.length)];
  else if (lead < 0.4) out += "'".repeat(1 + Math.floor(next() * 3)) + FORMULA_TRIGGERS[Math.floor(next() * FORMULA_TRIGGERS.length)];
  else if (lead < 0.5) out += "'";
  for (let i = 0; i < length; i += 1) out += ALPHABET[Math.floor(next() * ALPHABET.length)];
  return out;
}

describe("the escape of formula characters", () => {
  it("lists exactly OWASP's seven", () => {
    expect([...FORMULA_TRIGGERS]).toEqual(["=", "+", "-", "@", "\t", "\r", "\n"]);
  });

  it("puts a ' in front of text that starts with one, and in front of text that starts with ' and then one", () => {
    for (const trigger of FORMULA_TRIGGERS) {
      expect(escapeText(`${trigger}1+1`)).toBe(`'${trigger}1+1`);
      expect(escapeText(`'${trigger}1+1`)).toBe(`''${trigger}1+1`);
      expect(startsLikeFormula(`${trigger}x`)).toBe(true);
    }
    expect(escapeText("hello")).toBe("hello");
    expect(escapeText("'hello")).toBe("'hello");
    expect(escapeText("a=b")).toBe("a=b");
    expect(escapeText("")).toBe("");
    expect(startsLikeFormula("1-2")).toBe(false);
  });

  it("is undone exactly, one quote at a time", () => {
    expect(unescapeText("'=1+1")).toBe("=1+1");
    expect(unescapeText("''=1+1")).toBe("'=1+1");
    expect(unescapeText("'hello")).toBe("'hello");
    expect(unescapeText("hello")).toBe("hello");
    expect(unescapeText("'")).toBe("'");
  });

  it("round-trips any text: unescape(escape(x)) is x, and an escaped text never starts like a formula", () => {
    const next = rng(20261005);
    for (let i = 0; i < 5000; i += 1) {
      const text = randomText(next);
      const escaped = escapeText(text);
      expect(unescapeText(escaped)).toBe(text);
      expect(startsLikeFormula(escaped)).toBe(false);
    }
  });
});

describe("writing", () => {
  it("writes CRLF between and after rows, quotes what needs it, and leaves nulls empty", () => {
    expect(writeCsv([["a", "b"], ['x "y"', "p,q"], ["line\nbreak", null]])).toBe('a,b\r\n"x ""y""","p,q"\r\n"line\nbreak",\r\n');
    expect(writeCsv([])).toBe("");
  });

  it("escapes a text cell and never a number cell", () => {
    expect(writeCsv([["=HYPERLINK(1)", { num: "-12.50" }, -5, 7, "-5"]])).toBe("'=HYPERLINK(1),-12.50,-5,7,'-5\r\n");
    expect(writeCsv([["+1", "@x", "\tx", "\rx"]])).toBe("'+1,'@x,'\tx,\"'\rx\"\r\n");
  });

  it("refuses a number cell that is not a number, so text cannot get through as one", () => {
    expect(() => writeCsv([[{ num: "=1+1" }]])).toThrow(/plain decimal/);
    expect(() => writeCsv([[{ num: "1,5" }]])).toThrow(/plain decimal/);
    expect(() => writeCsv([[{ num: "" }]])).toThrow();
    expect(() => writeCsv([[1.5]])).toThrow(/integer/);
    expect(() => writeCsv([[Number.NaN]])).toThrow();
  });

  it("has the Nordic dialect: semicolon, decimal comma, a byte order mark, and a comma in text unquoted", () => {
    const text = writeCsv([["Navn", "Pris"], ["Brød, rundstykker", { num: "12.50" }], ["a;b", { num: "-3" }], ["x", 4]], "excel_nordic");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toBe('﻿Navn;Pris\r\nBrød, rundstykker;12,50\r\n"a;b";-3\r\nx;4\r\n');
    expect(DIALECTS.standard.bom).toBe(false);
    expect(writeCsv([["a"]], "standard").charCodeAt(0)).toBe("a".charCodeAt(0));
  });

  it("keeps the output of the older toCsv() for the cases both handle", () => {
    const rows: (string | number | null)[][] = [["Name", "Amount"], ['Kari "K", AS', 3], ["=HYPERLINK(1)", null], [null, "line\nbreak"]];
    expect(writeCsv(rows)).toBe(toCsv(rows));
  });
});

describe("reading", () => {
  it("reads quotes, doubled quotes, embedded newlines and every line ending", () => {
    expect(parseCsv('a,b\r\n"x ""y""","p,q"\r\n"line\nbreak",\r\n').rows).toEqual([["a", "b"], ['x "y"', "p,q"], ["line\nbreak", ""]]);
    expect(parseCsv("a,b\nc,d\n").rows).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseCsv("a,b\rc,d\r").rows).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseCsv("a,b\r\n\r\nc,d").rows).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("finds the delimiter from the header, outside quotes", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n")).toBe("\t");
    expect(detectDelimiter('"a;b;c",d\n')).toBe(",");
    expect(detectDelimiter("single\nrow")).toBe(",");
    expect(parseCsv("Pris;Navn\r\n12,50;Brød, rundstykker\r\n").rows[1]).toEqual(["12,50", "Brød, rundstykker"]);
    expect(parseCsv("a,b;c\n1,2;3", { delimiter: ";" }).rows[0]).toEqual(["a,b", "c"]);
  });

  it("reads a byte order mark, UTF-16, and falls back to Windows-1252 (Excel's plain CSV) saying so", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Brød;1\r\n")]);
    expect(decodeCsv(bom)).toMatchObject({ text: "Brød;1\r\n", encoding: "utf-8", bom: true, assumed: false });
    expect(parseCsv(bom).rows).toEqual([["Brød", "1"]]);
    // "Brød" in Windows-1252: ø is 0xF8, invalid as UTF-8.
    const legacy = new Uint8Array([0x42, 0x72, 0xf8, 0x64, 0x3b, 0x31]);
    expect(decodeCsv(legacy)).toMatchObject({ text: "Brød;1", encoding: "windows-1252", assumed: true });
    const utf16 = new Uint8Array([0xff, 0xfe, ...[..."a\tå"].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
    expect(parseCsv(utf16)).toMatchObject({ rows: [["a", "å"]], encoding: "utf-16le", assumed: false });
    expect(decodeCsv(new TextEncoder().encode("æøå"))).toMatchObject({ text: "æøå", encoding: "utf-8", assumed: false });
    expect(parseCsv("﻿a,b").rows[0]).toEqual(["a", "b"]);
  });

  it("reports ragged rows by their number (the header is row 1) and a quote that never closes", () => {
    const parsed = parseCsv("a,b,c\n1,2,3\n4,5\n6,7,8,9\n");
    expect(parsed.ragged).toEqual([3, 4]);
    expect(parseCsv('a,b\n"open,1').unterminated).toBe(true);
    expect(parseCsv("a,b\n1,2").unterminated).toBe(false);
  });

  it("gives records by header name, short rows empty, a repeated name its first", () => {
    const { header, records } = recordsOf([[" a ", "b", "a"], ["1", "2", "3"], ["4"]]);
    expect(header).toEqual(["a", "b", "a"]);
    expect(records).toEqual([{ a: "1", b: "2" }, { a: "4", b: "" }]);
  });

  it("reads whole numbers", () => {
    expect(parseInteger("12")).toBe(12);
    expect(parseInteger(" -3 ")).toBe(-3);
    expect(parseInteger("1.5")).toBeNull();
    expect(parseInteger("1 000")).toBeNull();
    expect(parseInteger("")).toBeNull();
    expect(parseInteger("1e3")).toBeNull();
  });
});

describe("a file written and read back", () => {
  const DIALECT_IDS: DialectId[] = ["standard", "excel_nordic"];

  it("keeps every text exactly, whatever it holds (random text with newlines, quotes, delimiters, tabs and triggers)", () => {
    const next = rng(165);
    for (const dialect of DIALECT_IDS) {
      for (let round = 0; round < 400; round += 1) {
        const width = 2 + Math.floor(next() * 4);
        const rows: string[][] = [];
        const height = 1 + Math.floor(next() * 5);
        for (let r = 0; r < height; r += 1) rows.push(Array.from({ length: width }, () => randomText(next)));
        // The delimiter is given: a random header is not a header (detection reads fixed column names, tested below).
        const parsed = parseCsv(writeCsv(rows as Cell[][], dialect), { delimiter: DIALECTS[dialect].delimiter });
        expect(parsed.rows.map((row) => row.map(unescapeText))).toEqual(rows);
      }
    }
  });

  it("detects the delimiter of what it wrote even when the texts hold the other delimiters", () => {
    const rows: Cell[][] = [["a", "b", "c"], ["x,y;z", "p;q,r", "t\tu"]];
    for (const dialect of DIALECT_IDS) {
      const parsed = parseCsv(writeCsv(rows, dialect));
      expect(parsed.delimiter).toBe(DIALECTS[dialect].delimiter);
      expect(parsed.rows).toEqual(rows);
    }
  });
});

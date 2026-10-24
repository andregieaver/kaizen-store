import { describe, expect, it } from "vitest";

import { importKey, readDate, readReviewFile, REVIEW_IMPORT_MAX } from "./review-import";

const TODAY = "2026-10-24";
const head = "product_handle,rating,title,body,author,date,source\n";

describe("readDate", () => {
  it("reads ISO days and times and the Nordic day.month.year, never a future or impossible day", () => {
    expect(readDate("2025-03-01", TODAY)).toBe("2025-03-01");
    expect(readDate("2025-03-01T10:20:30Z", TODAY)).toBe("2025-03-01");
    expect(readDate("01.03.2025", TODAY)).toBe("2025-03-01");
    expect(readDate("2025-02-30", TODAY)).toBeNull();
    expect(readDate("2027-01-01", TODAY)).toBeNull();
    expect(readDate("1999-12-31", TODAY)).toBeNull();
    expect(readDate("3/1/2025", TODAY)).toBeNull();
  });
});

describe("readReviewFile", () => {
  it("reads each row, cleaned, and refuses bad rows by line and column", () => {
    const file =
      head +
      'shirt,5,Great,"Fits well.\nWashes well.",Kari N.,2025-03-01,Judge.me\n' +
      "Shirt,4,,,Ola,2025-03-02,\n" +
      "shirt,6,Too many,,Per,2025-03-03,\n" +
      "shirt,3,,,,2025-03-04,\n" +
      "shirt,3,,,Ann,2099-01-01,\n" +
      "not a handle,3,,,Ann,2025-03-04,\n";
    const read = readReviewFile(file, "Old shop", TODAY);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.rows).toEqual([
      { line: 2, handle: "shirt", rating: 5, title: "Great", body: "Fits well.\nWashes well.", author: "Kari N.", date: "2025-03-01", source: "Judge.me" },
      { line: 3, handle: "shirt", rating: 4, title: null, body: null, author: "Ola", date: "2025-03-02", source: "Old shop" },
    ]);
    expect(read.refused).toEqual([
      { line: 4, problem: "rating" },
      { line: 5, problem: "author" },
      { line: 6, problem: "date" },
      { line: 7, problem: "handle" },
    ]);
  });

  it("undoes a formula escape and refuses a file without the needed columns, an empty one or one too long", () => {
    const read = readReviewFile(head + "shirt,5,'=great,,Kari,2025-03-01,X\n", "", TODAY);
    expect(read.ok && read.rows[0].title).toBe("=great");
    expect(readReviewFile("product_handle,rating\nshirt,5\n", "x", TODAY)).toEqual({ ok: false, problem: "columns", missing: ["author", "date"] });
    expect(readReviewFile(head, "x", TODAY)).toEqual({ ok: false, problem: "empty" });
    expect(readReviewFile(head + "shirt,5,,,A,2025-03-01,X\n".repeat(REVIEW_IMPORT_MAX + 1), "x", TODAY)).toEqual({ ok: false, problem: "too_many" });
  });

  it("needs a source from the row or the import", () => {
    const read = readReviewFile(head + "shirt,5,,,Kari,2025-03-01,\n", "  ", TODAY);
    expect(read.ok && read.refused).toEqual([{ line: 2, problem: "source" }]);
  });
});

describe("importKey", () => {
  it("is the same for the same review whatever the case of its author and source", () => {
    const a = { handle: "shirt", rating: 5, author: "Kari", date: "2025-03-01", source: "Judge.me", body: "Nice" };
    expect(importKey(a)).toBe(importKey({ ...a, author: "KARI", source: "judge.me" }));
    expect(importKey(a)).not.toBe(importKey({ ...a, rating: 4 }));
  });
});

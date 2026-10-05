import { describe, expect, it } from "vitest";

import {
  COMPARE_AT_NOTE,
  IMPORT_CONFIRMATION,
  NO_CONSENT_NOTE,
  PERSONAL_DATA_WARNING,
  appliedCountsOfJob,
  doneOfTotal,
  dryCountsOfJob,
  exportPath,
  expiryWords,
  formatBytes,
  importStage,
  isWorking,
  momentText,
  rowsPhrase,
  severityFilterOf,
  workingWords,
  wholeNumber,
} from "./data-admin";
import { JOB_STATUSES } from "./data-job";
import { EXPORT_KEEP_DAYS } from "./data-limits";

describe("the sentences that touch the law", () => {
  it("say what the spec says (section 8 lists them for a person to read)", () => {
    expect(PERSONAL_DATA_WARNING).toBe(`This file contains personal data. Keep it only as long as you need it; it is deleted from here after ${EXPORT_KEEP_DAYS} days.`);
    expect(PERSONAL_DATA_WARNING).toContain("7 days");
    expect(NO_CONSENT_NOTE).toBe("Kaizen does not record marketing consent yet. Do not treat this file as a mailing list.");
    expect(IMPORT_CONFIRMATION).toContain("You cannot undo an import as a whole");
    expect(COMPARE_AT_NOTE).toContain("lowest price of the last 30 days");
  });
});

describe("sizes and times", () => {
  it("formats bytes", () => {
    expect(formatBytes(812)).toBe("812 B");
    expect(formatBytes(14_540)).toBe("14.2 KB");
    expect(formatBytes(3_670_016)).toBe("3.5 MB");
    expect(formatBytes(-1)).toBe("");
  });
  it("formats whole numbers the same on server and browser", () => {
    expect(wholeNumber(1234567)).toBe("1,234,567");
  });
  it("shows a moment in the store's time zone", () => {
    expect(momentText("2026-10-05T22:30:00Z", "Europe/Oslo")).toContain("6 Oct 2026");
    expect(momentText("2026-10-05T22:30:00Z", "Not/AZone")).toContain("5 Oct 2026");
    expect(momentText(null, "UTC")).toBe("");
    expect(momentText("nonsense", "UTC")).toBe("");
  });
  it("says how long a file is kept", () => {
    const now = new Date("2026-10-05T12:00:00Z");
    expect(expiryWords("2026-10-12T12:00:00Z", now)).toBe("expires in 7 days");
    expect(expiryWords("2026-10-06T12:00:00Z", now)).toBe("expires in 1 day");
    expect(expiryWords("2026-10-05T15:00:00Z", now)).toBe("expires in 3 hours");
    expect(expiryWords("2026-10-05T11:00:00Z", now)).toBe("expired");
    expect(expiryWords(null, now)).toBe("");
  });
});

describe("a job's counts", () => {
  it("reads the dry run and the applied counts, zero for what is missing or not a number", () => {
    expect(dryCountsOfJob({ dry: { toCreate: 3, toUpdate: 2, unchanged: 1, withProblems: "x" } })).toEqual({ toCreate: 3, toUpdate: 2, unchanged: 1, withProblems: 0 });
    expect(dryCountsOfJob({})).toEqual({ toCreate: 0, toUpdate: 0, unchanged: 0, withProblems: 0 });
    expect(appliedCountsOfJob({ created: 4, failed: 1, pricesChanged: 9 })).toMatchObject({ created: 4, failed: 1, pricesChanged: 9, updated: 0, termsCreated: 0 });
  });
  it("words progress", () => {
    expect(doneOfTotal(120, 400, "rows")).toBe("120 of 400 rows");
    expect(doneOfTotal(null, 400, "rows")).toBe("0 of 400 rows");
    expect(doneOfTotal(5, null, "rows")).toBe("5 rows");
    expect(doneOfTotal(null, null, "rows")).toBe("");
  });
});

describe("where an import is", () => {
  it("draws queued and running as applying, the rest as they are", () => {
    expect(importStage("queued")).toBe("applying");
    expect(importStage("running")).toBe("applying");
    for (const s of JOB_STATUSES.filter((s) => s !== "queued" && s !== "running")) expect(importStage(s)).toBe(s);
  });
  it("keeps a page asking for the next step only while a job is worked on", () => {
    expect(JOB_STATUSES.filter(isWorking)).toEqual(["checking", "queued", "running"]);
  });
  it("words the work", () => {
    expect(workingWords("product_import", "checking", "check")).toBe("Checking the file");
    expect(workingWords("product_import", "running", "apply")).toBe("Saving products");
    expect(workingWords("redirect_import", "checking", "check")).toBe("Checking the file");
    expect(workingWords("redirect_import", "running", "apply")).toBe("Saving redirects");
    expect(workingWords("order_export", "queued", null)).toBe("Waiting to start");
    expect(workingWords("order_export", "running", "write")).toBe("Preparing your file");
    expect(workingWords("customer_export", "running", "assemble")).toBe("Putting the file together");
  });
  it("knows the export pages", () => {
    expect(exportPath("product_export")).toBe("/products/export");
    expect(exportPath("order_export")).toBe("/orders/export");
    expect(exportPath("customer_export")).toBe("/customers/export");
  });
});

describe("findings", () => {
  it("takes only a known severity filter", () => {
    expect(severityFilterOf("error")).toBe("error");
    expect(severityFilterOf("<script>")).toBe("all");
    expect(severityFilterOf(undefined)).toBe("all");
  });
  it("words rows", () => {
    expect(rowsPhrase([])).toBe("");
    expect(rowsPhrase([4])).toBe("4");
    expect(rowsPhrase([9, 3, 4, 3])).toBe("3, 4 and 9");
    expect(rowsPhrase([1, 2, 3, 4, 5, 6, 7])).toBe("1 to 7 (7 rows)");
  });
});

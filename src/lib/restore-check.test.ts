import { describe, expect, it } from "vitest";

import { countFindings, cronFinding, documentFindings, migrationFinding, orderSequenceFinding, report } from "../../scripts/lib/restore-check.mjs";

/** The restore drill's judgements (docs/runbooks/restore.md, `scripts/restore-check.mjs`). */
describe("the restore check", () => {
  it("fails while a copy's scheduled jobs still call out, and says how to stop them", () => {
    expect(cronFinding([]).status).toBe("ok");
    expect(cronFinding([{ jobname: "prune", active: true, calls_out: false }]).status).toBe("ok");
    const calling = cronFinding([{ jobname: "dispatcher", active: true, calls_out: true }, { jobname: "off", active: false, calls_out: true }]);
    expect(calling.status).toBe("fail");
    expect(calling.detail).toContain("dispatcher");
    expect(calling.detail).not.toContain("off,");
    expect(calling.detail).toContain("cron.unschedule");
  });

  it("reads the ledger: newer files are expected, gaps, unknown files and an empty ledger fail", () => {
    const files = ["001_a.sql", "002_b.sql", "003_c.sql"];
    expect(migrationFinding(files, files).status).toBe("ok");
    expect(migrationFinding(files, ["001_a.sql", "002_b.sql"])).toMatchObject({ status: "differs", detail: expect.stringContaining("003_c.sql") });
    expect(migrationFinding(files, ["001_a.sql", "003_c.sql"])).toMatchObject({ status: "fail", detail: expect.stringContaining("002_b.sql") });
    expect(migrationFinding(files, [...files, "004_d.sql"]).status).toBe("fail");
    expect(migrationFinding(files, []).status).toBe("fail");
    const many = Array.from({ length: 9 }, (_, i) => `00${i}_x.sql`);
    expect(migrationFinding(many, [many[0]]).detail).toContain("and 3 more");
  });

  it("compares counts and documents with the reference at the same moment, as worth a look rather than a failure", () => {
    expect(countFindings({ orders: 3 }, null)[0]).toMatchObject({ status: "ok", detail: "3" });
    expect(countFindings({ orders: 3 }, { orders: 3 })[0].status).toBe("ok");
    expect(countFindings({ orders: 3 }, { orders: 4 })[0]).toMatchObject({ status: "differs", detail: "3 on the copy, 4 on the reference then" });
    expect(documentFindings("invoice", { demo: "F-8" }, { demo: "F-8" })[0].status).toBe("ok");
    expect(documentFindings("invoice", { demo: "F-8" }, { demo: "F-9", other: "F-1" }).map((f) => f.status)).toEqual(["differs", "differs"]);
  });

  it("fails a broken order sequence, and the report says whether anything failed", () => {
    expect(orderSequenceFinding("demo", { ok: true, missing: 0, off_format: 0, orders: 12 }).status).toBe("ok");
    const broken = orderSequenceFinding("demo", { ok: false, missing: "2", off_format: "0", orders: "12" });
    expect(broken).toMatchObject({ status: "fail", detail: "2 missing and 0 off the format among 12 orders" });
    expect(report([broken]).failed).toBe(true);
    expect(report([cronFinding([])])).toMatchObject({ failed: false, text: expect.stringContaining("1 ok, 0 differs, 0 fail") });
  });
});

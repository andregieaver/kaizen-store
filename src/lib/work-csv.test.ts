import { describe, expect, it } from "vitest";

import {
  CSV_CONTENT_TYPE,
  buildCsv,
  buildWorkReport,
  creditNotesToCsv,
  csvFileName,
  invoiceListToCsv,
  invoiceToCsv,
  paymentsToCsv,
  withBom,
  workReportToCsv,
  type InvoiceCsv,
  type WorkReport,
} from "./work-csv";

describe("buildCsv", () => {
  it("quotes what needs it (RFC 4180) and ends lines with CRLF", () => {
    expect(buildCsv([["a", "b,c", 'say "hi"', "line\nbreak", null, 5]])).toBe(
      'a,"b,c","say ""hi""","line\nbreak",,5\r\n',
    );
    expect(buildCsv([["x"], [], ["y"]])).toBe("x\r\n\r\ny\r\n");
    expect(CSV_CONTENT_TYPE).toBe("text/csv; charset=utf-8");
  });

  it("makes text a spreadsheet would run as a formula plain text", () => {
    const risky = ['=HYPERLINK("http://evil","x")', "+SUM(A1)", "-2+3", "@cmd", "\tTAB", "\rCR", "=1+1"];
    for (const text of risky) {
      const cell = buildCsv([[text]]).trimEnd();
      expect(cell.startsWith("'") || cell.startsWith("\"'"), text).toBe(true);
    }
    // the same in every place a name can be typed
    expect(buildCsv([["Acme", "=cmd|' /C calc'!A0"]])).toBe("Acme,'=cmd|' /C calc'!A0\r\n");
  });

  it("leaves amounts, negative amounts and ordinary text alone", () => {
    expect(buildCsv([["-12.50", "1234.50", "0.05", "-5", "hello - world", "e-mail"]])).toBe(
      "-12.50,1234.50,0.05,-5,hello - world,e-mail\r\n",
    );
  });

  it("puts a byte order mark first for Excel", () => {
    expect(withBom("a\r\n")).toBe("﻿a\r\n");
  });
});

describe("csvFileName", () => {
  it("keeps only safe characters, so a typed name cannot break the download's header", () => {
    expect(csvFileName("work-report", "Acme Inc.", "2026-09-01", "2026-09-30")).toBe(
      "work-report-Acme-Inc.-2026-09-01-2026-09-30.csv",
    );
    const evil = csvFileName('x"; filename="evil.exe', "a\r\nSet-Cookie: b=c");
    expect(evil).toMatch(/^[A-Za-z0-9._-]+\.csv$/);
    expect(evil).not.toMatch(/[\r\n";=\s]/);
  });

  it("drops accents, leading dots and empty parts", () => {
    expect(csvFileName("Åse Frøland")).toBe("Ase-Fr-land.csv");
    expect(csvFileName("..", "hidden")).toBe("hidden.csv");
    expect(csvFileName(null, "", undefined)).toBe("export.csv");
    expect(csvFileName("../../etc/passwd")).toBe("etc-passwd.csv");
  });
});

describe("the client period report", () => {
  const client = { name: "Acme, Inc", currency: "NOK", defaultHourlyRateMinor: 90_000 };
  const assignments = [
    { id: "a1", name: "Website", billingType: "hourly" as const, hourlyRateMinor: 120_000, fixedAmountMinor: null },
    { id: "a2", name: "Retainer", billingType: "fixed_fee" as const, hourlyRateMinor: null, fixedAmountMinor: 500_000 },
    { id: "a3", name: "Quiet", billingType: "hourly" as const, hourlyRateMinor: null, fixedAmountMinor: null },
  ];
  const entries = [
    { assignmentId: "a1", taskId: "t1", workDate: "2026-09-11", minutes: 30, billable: false, note: "=1+1" },
    { assignmentId: "a1", taskId: null, workDate: "2026-09-10", minutes: 90, billable: true, note: null },
    {
      assignmentId: "a1",
      taskId: "t1",
      workDate: "2026-10-01",
      minutes: 60,
      billable: true,
      note: "outside the period",
    },
    { assignmentId: "a3", taskId: null, workDate: "2026-08-31", minutes: 60, billable: true, note: null },
  ];
  const build = (fixedFeeInPeriodMinor?: number) =>
    buildWorkReport({
      client,
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      assignments: assignments.map((a) => (a.id === "a2" ? { ...a, fixedFeeInPeriodMinor } : a)),
      entries,
      taskTitles: new Map([["t1", "Design"]]),
    });

  it("lists assignments with time in the period, in date order, at their rates", () => {
    const report = build();
    expect(report.assignments.map((a) => a.name)).toEqual(["Website"]);
    const website = report.assignments[0];
    expect(website.entries.map((e) => [e.workDate, e.taskTitle, e.minutes])).toEqual([
      ["2026-09-10", null, 90],
      ["2026-09-11", "Design", 30],
    ]);
    expect(website).toMatchObject({ periodMinutes: 120, periodBillableMinutes: 90, periodAmountMinor: 180_000 });
    expect(report).toMatchObject({
      totalMinutes: 120,
      totalBillableMinutes: 90,
      totalAmountMinor: 180_000,
      currency: "NOK",
    });
  });

  it("counts a fixed fee once, in the period it was invoiced, and not in every period shown", () => {
    expect(build(undefined).assignments.map((a) => a.name)).toEqual(["Website"]);
    expect(build(0).assignments.map((a) => a.name)).toEqual(["Website"]);
    const withFee = build(500_000);
    expect(withFee.assignments.map((a) => a.name)).toEqual(["Website", "Retainer"]);
    expect(withFee.assignments[1].periodAmountMinor).toBe(500_000);
    expect(withFee.totalAmountMinor).toBe(680_000);
  });

  it("falls back to the client's rate when the assignment has none", () => {
    const report = buildWorkReport({
      client,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      assignments,
      entries,
      taskTitles: new Map(),
    });
    expect(report.assignments.map((a) => [a.name, a.periodAmountMinor])).toEqual([["Quiet", 90_000]]);
  });

  it("writes Life's layout, exactly, with text safe for a spreadsheet", () => {
    expect(workReportToCsv(build())).toBe(
      [
        "Client,Period Start,Period End,Currency",
        '"Acme, Inc",2026-09-01,2026-09-30,NOK',
        "",
        "Assignment,Billing Type,Period Hours,Period Billable Hours,Period Amount",
        "Website,hourly,2.00,1.50,1800.00",
        "",
        "Date,Assignment,Task,Minutes,Billable,Note",
        "2026-09-10,Website,,90,yes,",
        "2026-09-11,Website,Design,30,no,'=1+1",
        "",
        "Total,,2.00,1.50,1800.00",
        "",
      ].join("\r\n"),
    );
  });

  it("writes hours to two decimals the way an invoice line does (20 min is 0.33 h)", () => {
    const report: WorkReport = {
      clientName: "X",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      currency: "SEK",
      assignments: [],
      totalMinutes: 20,
      totalBillableMinutes: 20,
      totalAmountMinor: 29_700,
    };
    expect(workReportToCsv(report)).toContain("Total,,0.33,0.33,297.00");
  });

  it("does not let a client's name run as a formula", () => {
    const report = build();
    report.clientName = '=HYPERLINK("http://evil")';
    const row = workReportToCsv(report).split("\r\n")[1];
    expect(row.startsWith("\"'=HYPERLINK")).toBe(true);
  });
});

describe("invoices, payments and credit notes", () => {
  const invoice: InvoiceCsv = {
    documentNumber: "W-1001",
    sellerName: "Kaizen Consulting AS",
    clientName: "Acme AS",
    clientEmail: "ap@acme.example",
    issuedOn: "2026-09-29",
    dueOn: "2026-10-13",
    currency: "NOK",
    reference: null,
    lines: [
      {
        description: "Design review, phase 1",
        quantityHundredths: 175,
        unitPriceMinor: 120_000,
        discountBp: 1250,
        vatBp: 2500,
        exclMinor: 183_750,
        vatMinor: 45_938,
        inclMinor: 229_688,
      },
    ],
    totals: { subtotalMinor: 183_750, vatMinor: 45_938, totalMinor: 229_688 },
  };

  it("writes one invoice with its lines and totals", () => {
    expect(invoiceToCsv(invoice)).toBe(
      [
        "Invoice number,W-1001",
        "Seller,Kaizen Consulting AS",
        "Client,Acme AS",
        "Client email,ap@acme.example",
        "Issued,2026-09-29",
        "Due,2026-10-13",
        "Currency,NOK",
        "Reference,",
        "",
        "Description,Quantity,Unit price,Discount %,VAT %,Excl,VAT,Incl",
        '"Design review, phase 1",1.75,1200.00,12.5,25,1837.50,459.38,2296.88',
        "",
        "Subtotal excl. VAT,,,,,1837.50",
        "Total VAT,,,,,459.38",
        "Total incl. VAT,,,,,2296.88",
        "",
      ].join("\r\n"),
    );
  });

  it("writes a draft with no number", () => {
    expect(invoiceToCsv({ ...invoice, documentNumber: null, issuedOn: null, dueOn: null })).toContain(
      "Invoice number,\r\n",
    );
  });

  it("writes the register, payments (refunds negative) and credit notes", () => {
    expect(
      invoiceListToCsv([
        {
          documentNumber: "W-1001",
          clientName: "Acme AS",
          status: "sent",
          issuedOn: "2026-09-29",
          dueOn: "2026-10-13",
          currency: "NOK",
          subtotalMinor: 183_750,
          vatMinor: 45_938,
          totalMinor: 229_688,
          paidMinor: 0,
        },
      ]),
    ).toBe(
      "Number,Client,Status,Issued,Due,Currency,Excl VAT,VAT,Total,Paid\r\nW-1001,Acme AS,sent,2026-09-29,2026-10-13,NOK,1837.50,459.38,2296.88,0.00\r\n",
    );
    expect(
      paymentsToCsv([
        {
          receivedOn: "2026-10-01",
          documentNumber: "W-1001",
          clientName: "Acme AS",
          method: "bank",
          amountMinor: 229_688,
          currency: "NOK",
          reference: "KID 123",
        },
        {
          receivedOn: "2026-10-05",
          documentNumber: "W-1001",
          clientName: "Acme AS",
          method: "bank",
          amountMinor: -50_000,
          currency: "NOK",
          reference: null,
        },
      ]),
    ).toBe(
      "Received,Invoice,Client,Method,Amount,Currency,Reference\r\n2026-10-01,W-1001,Acme AS,bank,2296.88,NOK,KID 123\r\n2026-10-05,W-1001,Acme AS,bank,-500.00,NOK,\r\n",
    );
    expect(
      creditNotesToCsv([
        {
          documentNumber: "WCN-1",
          invoiceNumber: "W-1001",
          issuedOn: "2026-10-10",
          clientName: "Acme AS",
          currency: "NOK",
          subtotalMinor: 100,
          vatMinor: 25,
          totalMinor: 125,
          reason: "Wrong rate, see email",
        },
      ]),
    ).toBe(
      'Number,Invoice,Issued,Client,Currency,Excl VAT,VAT,Total,Reason\r\nWCN-1,W-1001,2026-10-10,Acme AS,NOK,1.00,0.25,1.25,"Wrong rate, see email"\r\n',
    );
  });

  it("makes a client name or a reason typed with a formula plain text in every export", () => {
    const evil = "=cmd|' /C calc'!A0";
    expect(invoiceToCsv({ ...invoice, clientName: evil })).toContain("Client,'=cmd|");
    expect(invoiceToCsv({ ...invoice, lines: [{ ...invoice.lines[0], description: "+1" }] })).toContain("'+1,");
    expect(
      creditNotesToCsv([
        {
          documentNumber: "WCN-1",
          invoiceNumber: "W-1",
          issuedOn: "2026-10-10",
          clientName: evil,
          currency: "NOK",
          subtotalMinor: 0,
          vatMinor: 0,
          totalMinor: 0,
          reason: "@x",
        },
      ]),
    ).toContain(",'@x");
  });
});

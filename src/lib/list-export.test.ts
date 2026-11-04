import { describe, expect, it } from "vitest";

import { readListExport } from "./list-export";

describe("an email list from Mailchimp or Klaviyo (D446 step 2b, Decision 2)", () => {
  it("takes Mailchimp's subscribed file: each address with its moment, confirmed when Mailchimp recorded a confirmation", () => {
    const csv = [
      "Email Address,First Name,Last Name,MEMBER_RATING,OPTIN_TIME,OPTIN_IP,CONFIRM_TIME,CONFIRM_IP",
      "Kari@Example.com,Kari,N,2,2024-03-01 10:00:00,1.2.3.4,2024-03-01 10:05:00,1.2.3.4",
      "ola@example.com,Ola,,2,2024-04-01 08:00:00,,,",
      "no-date@example.com,No,Date,2,,,,",
      "kari@example.com,Kari,Again,2,2024-03-01 10:00:00,,2024-03-01 10:05:00,",
    ].join("\n");
    expect(readListExport(csv)).toEqual({
      ok: true,
      source: "mailchimp",
      skipped: 2,
      lines: [
        { email: "kari@example.com", name: "Kari N", state: "SUBSCRIBED", level: "CONFIRMED_OPT_IN", updatedAt: "2024-03-01T10:05:00.000Z" },
        { email: "ola@example.com", name: "Ola", state: "SUBSCRIBED", level: "SINGLE_OPT_IN", updatedAt: "2024-04-01T08:00:00.000Z" },
      ],
    });
  });

  it("refuses Mailchimp's file of people who left or bounced, whole", () => {
    expect(readListExport("Email Address,OPTIN_TIME,UNSUB_TIME\na@example.com,2024-01-01 00:00:00,2024-02-01 00:00:00")).toEqual({ ok: false, problem: "not_subscribed_file" });
    expect(readListExport("Email Address,OPTIN_TIME,CLEAN_TIME\na@example.com,2024-01-01 00:00:00,2024-02-01 00:00:00")).toEqual({ ok: false, problem: "not_subscribed_file" });
  });

  it("takes Klaviyo's subscribed profiles with their consent's moment, and nobody else", () => {
    const csv = [
      "Email,First Name,Last Name,Email Marketing Consent,Email Marketing Consent Timestamp,Email Marketing Double Optin",
      "kari@example.com,Kari,N,SUBSCRIBED,2025-03-02T10:00:00+00:00,True",
      "ola@example.com,Ola,,UNSUBSCRIBED,2025-03-02T10:00:00+00:00,False",
      "never@example.com,,,NEVER_SUBSCRIBED,,",
      "nodate@example.com,,,SUBSCRIBED,,",
    ].join("\n");
    expect(readListExport(csv)).toEqual({
      ok: true,
      source: "klaviyo",
      skipped: 3,
      lines: [{ email: "kari@example.com", name: "Kari N", state: "SUBSCRIBED", level: "CONFIRMED_OPT_IN", updatedAt: "2025-03-02T10:00:00.000Z" }],
    });
  });

  it("says when a file is not one of theirs", () => {
    expect(readListExport("email,name\na@example.com,A")).toEqual({ ok: false, problem: "columns" });
    expect(readListExport("Email Address,OPTIN_TIME")).toEqual({ ok: false, problem: "empty" });
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { amzDates, signRequest } from "./aws-sigv4";

describe("AWS Signature Version 4 (D872)", () => {
  it("signs AWS's published example as AWS does", () => {
    // AWS's "Signature Version 4 signing process" example: IAM ListUsers on 30 August 2015 with the documentation's example keys.
    const headers = signRequest(
      { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" },
      {
        method: "GET",
        url: "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08",
        region: "us-east-1",
        service: "iam",
        headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
        now: new Date("2015-08-30T12:36:00Z"),
        contentHash: false,
      },
    );
    expect(headers.Authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
    );
    expect(headers["X-Amz-Date"]).toBe("20150830T123600Z");
  });

  it("signs the body's hash with a POST", () => {
    const headers = signRequest(
      { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" },
      { method: "POST", url: "https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails", region: "eu-west-1", service: "ses", headers: { "Content-Type": "application/json" }, body: "{}", now: new Date("2026-11-23T10:00:00Z") },
    );
    expect(headers["X-Amz-Content-Sha256"]).toBe("44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261123\/eu-west-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  });

  it("writes the moment as AWS wants it", () => {
    expect(amzDates(new Date("2026-01-02T03:04:05.678Z"))).toEqual({ stamp: "20260102T030405Z", day: "20260102" });
  });
});

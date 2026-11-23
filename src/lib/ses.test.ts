import { describe, expect, it } from "vitest";

import { mailEventOf, readSesIdentity, readSnsMessage, sesMailFrom, sesRecords, sesStatusOf, snsCertUrlOk, snsStringToSign, snsSubscribeUrlOk } from "./ses";

const TOKENS = ["abcdefghijklmnop1234567890abcdef", "bcdefghijklmnop1234567890abcdefa", "cdefghijklmnop1234567890abcdefab"];

describe("SES's view of a sending domain (D872)", () => {
  it("reads SES's answer and its state", () => {
    const pending = readSesIdentity({ IdentityType: "DOMAIN", VerifiedForSendingStatus: false, DkimAttributes: { Status: "PENDING", Tokens: TOKENS } });
    expect(pending).toEqual({ verified: false, dkimStatus: "PENDING", tokens: TOKENS, mailFromStatus: "PENDING" });
    expect(sesStatusOf(pending!)).toBe("pending");
    const verified = readSesIdentity({ VerifiedForSendingStatus: true, DkimAttributes: { Status: "SUCCESS", Tokens: TOKENS }, MailFromAttributes: { MailFromDomainStatus: "SUCCESS" } });
    expect(sesStatusOf(verified!)).toBe("verified");
    expect(sesStatusOf(readSesIdentity({ VerifiedForSendingStatus: false, DkimAttributes: { Status: "FAILED", Tokens: TOKENS } })!)).toBe("failed");
    // A token of the wrong shape is never written into a zone.
    expect(readSesIdentity({ DkimAttributes: { Tokens: ["x.evil.com"] } })).toBeNull();
    expect(readSesIdentity("nope")).toBeNull();
  });

  it("asks for three DKIM CNAMEs and the MAIL FROM's MX and SPF on ses.", () => {
    const identity = readSesIdentity({ VerifiedForSendingStatus: false, DkimAttributes: { Status: "SUCCESS", Tokens: TOKENS }, MailFromAttributes: { MailFromDomainStatus: "PENDING" } })!;
    const records = sesRecords("kopp.no", "eu-west-1", identity);
    expect(sesMailFrom("kopp.no")).toBe("ses.kopp.no");
    expect(records).toHaveLength(5);
    expect(records[0]).toEqual({ purpose: "DKIM", type: "CNAME", host: `${TOKENS[0]}._domainkey.kopp.no`, value: `${TOKENS[0]}.dkim.amazonses.com`, status: "verified" });
    expect(records[3]).toEqual({ purpose: "SPF", type: "MX", host: "ses.kopp.no", value: "feedback-smtp.eu-west-1.amazonses.com", priority: 10, status: "pending" });
    expect(records[4]).toMatchObject({ type: "TXT", host: "ses.kopp.no", value: "v=spf1 include:amazonses.com ~all" });
  });
});

describe("SES's events as the email log's (D872)", () => {
  const mail = { messageId: "0102018c-abc" };
  it("records deliveries, bounces with their kind, complaints and rejections", () => {
    expect(mailEventOf({ eventType: "Delivery", mail })).toEqual({ type: "email.delivered", data: { email_id: "0102018c-abc" } });
    expect(mailEventOf({ eventType: "Bounce", mail, bounce: { bounceType: "Permanent", bounceSubType: "General", bouncedRecipients: [{ diagnosticCode: "550 5.1.1 user unknown" }] } })).toEqual({
      type: "email.bounced",
      data: { email_id: "0102018c-abc", bounce: { type: "Permanent", message: "550 5.1.1 user unknown" } },
    });
    expect(mailEventOf({ notificationType: "Complaint", mail })).toEqual({ type: "email.complained", data: { email_id: "0102018c-abc" } });
    expect(mailEventOf({ eventType: "Reject", mail, reject: { reason: "Bad content" } })).toEqual({ type: "email.failed", data: { email_id: "0102018c-abc", failed: { reason: "Bad content" } } });
  });

  it("ignores what it does not record and what names no email", () => {
    expect(mailEventOf({ eventType: "Send", mail })).toBeNull();
    expect(mailEventOf({ eventType: "Open", mail })).toBeNull();
    expect(mailEventOf({ eventType: "Delivery", mail: {} })).toBeNull();
    expect(mailEventOf(null)).toBeNull();
  });
});

describe("SNS messages (D872)", () => {
  const base = {
    Type: "Notification",
    MessageId: "m1",
    TopicArn: "arn:aws:sns:eu-west-1:123456789012:kaizena-ses",
    Message: "{}",
    Timestamp: "2026-11-23T10:00:00.000Z",
    SignatureVersion: "2",
    Signature: "c2ln",
    SigningCertURL: "https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc.pem",
  };

  it("reads a message and lays out what SNS signed", () => {
    const m = readSnsMessage(base)!;
    expect(snsStringToSign(m)).toBe("Message\n{}\nMessageId\nm1\nTimestamp\n2026-11-23T10:00:00.000Z\nTopicArn\narn:aws:sns:eu-west-1:123456789012:kaizena-ses\nType\nNotification\n");
    expect(snsStringToSign({ ...m, Subject: "Hi" })).toContain("MessageId\nm1\nSubject\nHi\nTimestamp");
    const confirm = readSnsMessage({ ...base, Type: "SubscriptionConfirmation", SubscribeURL: "https://x", Token: "t" })!;
    expect(snsStringToSign(confirm)).toBe(`Message\n{}\nMessageId\nm1\nSubscribeURL\nhttps://x\nTimestamp\n${base.Timestamp}\nToken\nt\nTopicArn\n${base.TopicArn}\nType\nSubscriptionConfirmation\n`);
    expect(readSnsMessage({ ...base, Signature: "" })).toBeNull();
  });

  it("trusts only SNS's own certificates and confirmation links", () => {
    expect(snsCertUrlOk(base.SigningCertURL)).toBe(true);
    expect(snsCertUrlOk("http://sns.eu-west-1.amazonaws.com/a.pem")).toBe(false);
    expect(snsCertUrlOk("https://sns.eu-west-1.amazonaws.com.evil.com/a.pem")).toBe(false);
    expect(snsCertUrlOk("https://evil.com/sns.eu-west-1.amazonaws.com/a.pem")).toBe(false);
    expect(snsSubscribeUrlOk("https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&Token=t", base.TopicArn)).toBe(true);
    expect(snsSubscribeUrlOk("https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription", base.TopicArn)).toBe(false);
    expect(snsSubscribeUrlOk("https://evil.com/?Action=ConfirmSubscription", base.TopicArn)).toBe(false);
  });
});

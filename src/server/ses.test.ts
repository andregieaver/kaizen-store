import { generateKeyPairSync, createSign } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const applyEmailEvent = vi.fn(async () => true);
vi.mock("./email-events", () => ({ applyEmailEvent }));
vi.mock("./log", () => ({ log: vi.fn() }));

const { deliverSes, deliverSesMany, headerName, UNCERTAIN, createSesIdentity } = await import("./ses");
const { receiveSesEvent, verifySns } = await import("./ses-events");
const { sesEnv } = await import("@/lib/env");
const { readSnsMessage, snsStringToSign } = await import("@/lib/ses");

const settings = { accessKeyId: "AKIAEXAMPLEEXAMPLE12", secretAccessKey: "secretsecretsecretsecret", region: "eu-west-1", configurationSet: "kaizena", topicArn: "arn:aws:sns:eu-west-1:123456789012:kaizena-ses" };
const message = { fromName: "Bøker & Kopp", fromAddress: "news@kopp.no", to: "kari@example.com", replyTo: "hei@kopp.no", subject: "Nytt", html: "<p>Hei</p>", text: "Hei", headers: { "List-Unsubscribe": "<https://x/u>" }, kind: "marketing.broadcast", storeId: "s1" };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

describe("SES's settings (D872)", () => {
  it("needs both keys, and an EU region", () => {
    expect(sesEnv({})).toBeNull();
    expect(sesEnv({ AWS_SES_ACCESS_KEY_ID: "AKIAEXAMPLEEXAMPLE12", AWS_SES_SECRET_ACCESS_KEY: "secretsecretsecretsecret" })).toMatchObject({ region: "eu-west-1", configurationSet: null, topicArn: null });
    expect(() => sesEnv({ AWS_SES_ACCESS_KEY_ID: "AKIAEXAMPLEEXAMPLE12", AWS_SES_SECRET_ACCESS_KEY: "secretsecretsecretsecret", AWS_SES_REGION: "us-east-1" })).toThrow(/inside the EU/);
    expect(() => sesEnv({ AWS_SES_ACCESS_KEY_ID: "nope", AWS_SES_SECRET_ACCESS_KEY: "secretsecretsecretsecret" })).toThrow(/access key id/);
  });
});

describe("Sending through SES (D872)", () => {
  it("sends one email as SES's API takes it, signed", async () => {
    const fetcher = vi.fn(async () => json(200, { MessageId: "0102-abc" }));
    expect(await deliverSes(settings, message, fetcher as unknown as typeof fetch)).toEqual({ ok: true, id: "0102-abc" });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails");
    expect(init.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLEEXAMPLE12\/\d{8}\/eu-west-1\/ses\/aws4_request/);
    const body = JSON.parse(String(init.body));
    expect(body.FromEmailAddress).toBe(`=?UTF-8?B?${Buffer.from("Bøker & Kopp").toString("base64")}?= <news@kopp.no>`);
    expect(body.Destination).toEqual({ ToAddresses: ["kari@example.com"] });
    expect(body.ReplyToAddresses).toEqual(["hei@kopp.no"]);
    expect(body.Content.Simple.Headers).toEqual([{ Name: "List-Unsubscribe", Value: "<https://x/u>" }]);
    expect(body.ConfigurationSetName).toBe("kaizena");
    expect(body.EmailTags).toEqual([{ Name: "kind", Value: "marketing_broadcast" }, { Name: "store", Value: "s1" }]);
  });

  it("tries again when busy, and never again when the call broke off", async () => {
    const busy = vi.fn().mockResolvedValueOnce(json(429, { message: "Maximum sending rate exceeded." }, { "x-amzn-errortype": "TooManyRequestsException:" })).mockResolvedValueOnce(json(200, { MessageId: "m2" }));
    expect(await deliverSes(settings, message, busy as unknown as typeof fetch)).toEqual({ ok: true, id: "m2" });
    const broke = vi.fn(async () => {
      throw new Error("The operation was aborted due to timeout");
    });
    const out = await deliverSes(settings, message, broke as unknown as typeof fetch);
    expect(out).toEqual({ ok: false, error: UNCERTAIN });
    expect(broke).toHaveBeenCalledTimes(1);
    // A sender's "try again later" never matches it.
    expect(/^(429|5\d\d)|network|abort|timeout/i.test(UNCERTAIN)).toBe(false);
    const refused = vi.fn(async () => json(400, { message: "Email address is not verified." }, { "x-amzn-errortype": "MessageRejected:" }));
    expect(await deliverSes(settings, message, refused as unknown as typeof fetch)).toEqual({ ok: false, error: "400 MessageRejected: Email address is not verified." });
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("sends many a few at a time, each result in its place", async () => {
    let n = 0;
    const fetcher = vi.fn(async () => json(200, { MessageId: `m${++n}` }));
    const out = await deliverSesMany(settings, [message, { ...message, to: "ola@example.com" }, { ...message, to: "per@example.com" }], fetcher as unknown as typeof fetch, 2);
    expect(out.map((d) => d.ok)).toEqual([true, true, true]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("writes a plain name in quotes and others as RFC 2047 words", () => {
    expect(headerName("Kopp & Kanne")).toBe('"Kopp & Kanne"');
    expect(headerName("Bøker")).toBe(`=?UTF-8?B?${Buffer.from("Bøker").toString("base64")}?=`);
  });

  it("makes a domain an identity with its MAIL FROM, and reads one SES already has", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url.replace("https://email.eu-west-1.amazonaws.com", "")}`);
      if (init.method === "POST") return json(409, { message: "exists" }, { "x-amzn-errortype": "AlreadyExistsException:" });
      if (init.method === "PUT") return json(200, {});
      return json(200, { VerifiedForSendingStatus: false, DkimAttributes: { Status: "PENDING", Tokens: [] } });
    });
    const out = await createSesIdentity(settings, "kopp.no", fetcher as unknown as typeof fetch);
    expect(out.ok).toBe(true);
    expect(calls).toEqual(["POST /v2/email/identities", "PUT /v2/email/identities/kopp.no/mail-from", "GET /v2/email/identities/kopp.no"]);
    expect(JSON.parse(String((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({ MailFromDomain: "ses.kopp.no", BehaviorOnMxFailure: "USE_DEFAULT_VALUE" });
  });
});

describe("SES's events through SNS (D872)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = publicKey.export({ type: "spki", format: "pem" }).toString();
  const now = Date.parse("2026-11-23T10:00:30Z");
  const signed = (fields: Record<string, string>) => {
    const m: Record<string, string> = {
      Type: "Notification",
      MessageId: "m1",
      TopicArn: settings.topicArn,
      Timestamp: "2026-11-23T10:00:00.000Z",
      SignatureVersion: "2",
      SigningCertURL: "https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc.pem",
      Message: JSON.stringify({ eventType: "Bounce", mail: { messageId: "0102-abc" }, bounce: { bounceType: "Permanent" } }),
      Signature: "unsigned",
      ...fields,
    };
    m.Signature = createSign("RSA-SHA256").update(snsStringToSign(readSnsMessage(m)!)).sign(privateKey, "base64");
    return m;
  };

  it("trusts a message SNS signed recently, and nothing changed in it", async () => {
    const m = signed({});
    const read = (x: Record<string, string>) => readSnsMessage(x)!;
    expect(await verifySns(read(m), { key, now })).toBe(true);
    expect(await verifySns(read({ ...m, Message: "{}" }), { key, now })).toBe(false);
    expect(await verifySns(read(m), { key, now: now + 2 * 60 * 60 * 1000 })).toBe(false);
    expect(await verifySns(read({ ...m, SigningCertURL: "https://evil.com/a.pem" }), { key, now })).toBe(false);
    // A certificate that is not one: refused.
    expect(await verifySns(read(m), { now, fetcher: (async () => new Response("not a certificate")) as unknown as typeof fetch })).toBe(false);
  });

  it("records an event from the topic, and refuses another topic's or one not set up", async () => {
    const m = signed({});
    expect(await receiveSesEvent(JSON.stringify(m), settings, { key, now })).toEqual({ status: 200, text: "Recorded" });
    expect(applyEmailEvent).toHaveBeenCalledWith({ type: "email.bounced", data: { email_id: "0102-abc", bounce: { type: "Permanent", message: undefined } } });
    expect((await receiveSesEvent(JSON.stringify(signed({ TopicArn: "arn:aws:sns:eu-west-1:123456789012:other" })), settings, { key, now })).status).toBe(403);
    expect((await receiveSesEvent(JSON.stringify(m), { ...settings, topicArn: null }, { key, now })).status).toBe(503);
    expect((await receiveSesEvent("nope", settings, { key, now })).status).toBe(400);
  });

  it("confirms the topic's subscription at SNS's own link", async () => {
    const m = signed({ Type: "SubscriptionConfirmation", SubscribeURL: "https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=x&Token=t", Token: "t", Message: "Confirm" });
    const fetcher = vi.fn(async () => new Response("<ok/>"));
    expect(await receiveSesEvent(JSON.stringify(m), settings, { key, now, fetcher: fetcher as unknown as typeof fetch })).toEqual({ status: 200, text: "Subscribed" });
    expect(fetcher).toHaveBeenCalledWith(m.SubscribeURL, expect.anything());
  });
});

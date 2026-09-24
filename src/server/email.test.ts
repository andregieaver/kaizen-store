import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { deliver, emailSettings, emailSetup, senderName } = await import("./email");
const { verifyEmailEvent } = await import("./email-events");

describe("emailSettings", () => {
  const full = { RESEND_API_KEY: "re_123", EMAIL_FROM: "butikk@kaizenstore.cloud" };

  it("needs a Resend key and a real sender address", () => {
    expect(emailSettings(full)).toEqual({ apiKey: "re_123", from: "butikk@kaizenstore.cloud" });
    expect(emailSettings({ ...full, RESEND_API_KEY: "" })).toBeNull();
    expect(emailSettings({ ...full, RESEND_API_KEY: "sk_live_x" })).toBeNull();
    expect(emailSettings({ ...full, EMAIL_FROM: "Kaizen <b@x.no>" })).toBeNull();
    expect(emailSetup(full)).toBe("ok");
    expect(emailSetup({})).toBe("not_set");
    expect(emailSetup({ RESEND_API_KEY: "wrong" })).toBe("unrecognised");
  });
});

describe("senderName", () => {
  it("keeps the store's name safe for an email header", () => {
    expect(senderName('Kopp "&" Kanne\r\nBcc: x')).toBe("Kopp & KanneBcc: x");
    expect(senderName("   ")).toBe("Kaizen");
  });
});

describe("deliver", () => {
  const settings = { apiKey: "re_123", from: "butikk@kaizenstore.cloud" };
  const message = {
    storeId: "11111111-1111-4111-8111-111111111111",
    kind: "order.confirmation",
    to: "kari@example.com",
    email: { subject: "Takk", html: "<p>Takk</p>", text: "Takk" },
    fromName: 'Kopp "&" Kanne',
    replyTo: "hei@kopp.no",
  };

  it("sends in the store's name, with the kept email's id as the idempotency key", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: "re-email-1" }));
    expect(await deliver(settings, "abc", message, fetcher)).toEqual({ ok: true, id: "re-email-1" });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_123", "Idempotency-Key": "email-abc" });
    expect(JSON.parse(init.body)).toEqual({
      from: '"Kopp & Kanne" <butikk@kaizenstore.cloud>',
      to: ["kari@example.com"],
      subject: "Takk",
      html: "<p>Takk</p>",
      text: "Takk",
      reply_to: ["hei@kopp.no"],
      tags: [
        { name: "kind", value: "order_confirmation" },
        { name: "store", value: "11111111-1111-4111-8111-111111111111" },
      ],
    });
  });

  it("tries again when Resend is busy, but not when the email is refused", async () => {
    const busy = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ name: "rate_limit_exceeded", message: "Too many" }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ id: "re-email-2" }));
    expect(await deliver(settings, "abc", message, busy)).toEqual({ ok: true, id: "re-email-2" });
    expect(busy).toHaveBeenCalledTimes(2);

    const refused = vi.fn().mockResolvedValue(
      Response.json({ name: "validation_error", message: "The domain is not verified." }, { status: 403 }),
    );
    expect(await deliver(settings, "abc", message, refused)).toEqual({
      ok: false,
      error: "403 validation_error: The domain is not verified.",
    });
    expect(refused).toHaveBeenCalledTimes(1);
  });
});

describe("verifyEmailEvent", () => {
  const secret = `whsec_${Buffer.from("a signing key for tests").toString("base64")}`;
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re-email-1" } });
  const now = 1_790_000_000_000;
  const timestamp = String(now / 1000);
  const sign = (content: string) =>
    createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(content).digest("base64");

  it("trusts only Resend's signature over this very body, recently", () => {
    const signature = `v1,${sign(`msg_1.${timestamp}.${body}`)}`;
    expect(verifyEmailEvent(body, { id: "msg_1", timestamp, signature }, secret, now)).toBe(true);
    // Among several signatures, while a secret is rotated.
    expect(verifyEmailEvent(body, { id: "msg_1", timestamp, signature: `v1,b2xk ${signature}` }, secret, now)).toBe(true);
    expect(verifyEmailEvent(`${body} `, { id: "msg_1", timestamp, signature }, secret, now)).toBe(false);
    expect(verifyEmailEvent(body, { id: "msg_2", timestamp, signature }, secret, now)).toBe(false);
    expect(verifyEmailEvent(body, { id: "msg_1", timestamp, signature }, secret, now + 10 * 60_000)).toBe(false);
    expect(verifyEmailEvent(body, { id: "msg_1", timestamp, signature: null }, secret, now)).toBe(false);
  });
});

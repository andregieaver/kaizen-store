import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { emailSettings, senderName } = await import("./email");

describe("emailSettings", () => {
  const full = {
    SES_REGION: "eu-north-1",
    SES_ACCESS_KEY_ID: "AKIA",
    SES_SECRET_ACCESS_KEY: "secret",
    EMAIL_FROM: "butikk@kaizenstore.cloud",
  };

  it("needs all four settings and a real sender address", () => {
    expect(emailSettings(full)).toEqual({
      region: "eu-north-1",
      accessKeyId: "AKIA",
      secretAccessKey: "secret",
      from: "butikk@kaizenstore.cloud",
    });
    expect(emailSettings({ ...full, SES_SECRET_ACCESS_KEY: "" })).toBeNull();
    expect(emailSettings({ ...full, EMAIL_FROM: "Kaizen <b@x.no>" })).toBeNull();
  });
});

describe("senderName", () => {
  it("keeps the store's name safe for an email header", () => {
    expect(senderName('Kopp "&" Kanne\r\nBcc: x')).toBe("Kopp & KanneBcc: x");
    expect(senderName("   ")).toBe("Kaizen");
  });
});

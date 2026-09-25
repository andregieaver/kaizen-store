import { describe, expect, it } from "vitest";

import { checkWebhookUrl, webhookHint } from "./integrations";

describe("webhook addresses (D41)", () => {
  it("takes the services' own addresses", () => {
    expect(checkWebhookUrl("zapier", " https://hooks.zapier.com/hooks/catch/1234567/abcdefg/ ")).toEqual({
      ok: true,
      url: "https://hooks.zapier.com/hooks/catch/1234567/abcdefg/",
    });
    expect(checkWebhookUrl("make", "https://hook.eu2.make.com/abc123").ok).toBe(true);
    expect(checkWebhookUrl("make", "https://hook.integromat.com/abc123").ok).toBe(true);
  });

  it("sends nowhere else: other hosts, plain http, ports, logins or the other service", () => {
    for (const url of [
      "http://hooks.zapier.com/hooks/catch/1/2/",
      "https://hooks.zapier.com:8443/hooks/catch/1/2/",
      "https://user:pw@hooks.zapier.com/hooks/catch/1/2/",
      "https://hooks.zapier.com.evil.example/hooks/catch/1/2/",
      "https://zapier.com/hooks/catch/1/2/",
      "https://hook.eu2.make.com/abc",
      "https://169.254.169.254/latest",
      "not a url",
    ]) {
      expect(checkWebhookUrl("zapier", url).ok, url).toBe(false);
    }
    expect(checkWebhookUrl("make", "https://make.com.evil.example/abc").ok).toBe(false);
    expect(checkWebhookUrl("make", "https://hooks.zapier.com/hooks/catch/1/2/").ok).toBe(false);
  });

  it("shows only where the address points, not its secret part", () => {
    expect(webhookHint("https://hooks.zapier.com/hooks/catch/1234567/abcdefg/")).toBe("hooks.zapier.com/hooks/catch/…defg");
    expect(webhookHint("https://hook.eu2.make.com/abcdefghijklmnop")).toBe("hook.eu2.make.com/…mnop");
  });
});

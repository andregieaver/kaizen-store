import { describe, expect, it } from "vitest";

import { checkWebhookUrl, isServiceEventOf, SERVICE_EVENTS, serviceEventsOf, webhookHint } from "./integrations";

/** A made-up Slack webhook, put together here so secret scanners do not take it for a real one. */
const slackHook = (team: string, bot: string, secret: string) => ["https://hooks.slack.com/services", team, bot, secret].join("/");

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

describe("Slack's webhook addresses (D101)", () => {
  const SLACK = slackHook("T0123ABCD", "B0456EFGH", "abcdEFGH1234ijklMNOP5678");

  it("takes a Slack incoming webhook and hides its secret", () => {
    expect(checkWebhookUrl("slack", ` ${SLACK} `)).toEqual({ ok: true, url: SLACK });
    expect(webhookHint(SLACK)).toBe("hooks.slack.com/services/…5678");
  });

  it("takes nothing else: other hosts, other Slack addresses, extra parts or the other services'", () => {
    for (const url of [
      slackHook("T0123ABCD", "B0456EFGH", "abcd").replace("https:", "http:"),
      slackHook("T0123ABCD", "B0456EFGH", "abcd").replace("hooks.slack.com", "hooks.slack.com.evil.example"),
      "https://hooks.slack.com/triggers/T0123ABCD/123/abcd",
      `${slackHook("T0123ABCD", "B0456EFGH", "abcd")}/more`,
      `${slackHook("T0123ABCD", "B0456EFGH", "abcd")}?x=1`,
      "https://slack.com/api/chat.postMessage",
      "https://hooks.zapier.com/hooks/catch/1234567/abcdefg/",
    ]) {
      expect(checkWebhookUrl("slack", url).ok, url).toBe(false);
    }
    expect(checkWebhookUrl("zapier", SLACK).ok).toBe(false);
  });
});

describe("what each service may be sent (D902, D901 P29)", () => {
  it("sends Zapier and Make the deals', activities' and leads' events", () => {
    for (const provider of ["zapier", "make"] as const) {
      const ids = serviceEventsOf(provider).map((e) => e.id);
      for (const id of ["deal.created", "deal.stage_changed", "deal.won", "deal.lost", "activity.created", "activity.done", "lead.dismissed", "lead.deal_made"]) {
        expect(ids).toContain(id);
        expect(isServiceEventOf(provider, id)).toBe(true);
      }
    }
  });

  it("tells Slack of deals but not of each activity or lead decision", () => {
    const ids = serviceEventsOf("slack").map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["deal.created", "deal.stage_changed", "deal.won", "deal.lost"]));
    for (const id of ["activity.created", "activity.done", "lead.dismissed", "lead.deal_made"]) {
      expect(ids).not.toContain(id);
      expect(isServiceEventOf("slack", id)).toBe(false);
    }
  });

  it("keeps the rest an owner's own endpoints' only", () => {
    expect(isServiceEventOf("zapier", "inventory.updated")).toBe(false);
    expect(isServiceEventOf("make", "customer.erased")).toBe(false);
    expect(SERVICE_EVENTS.every((e) => isServiceEventOf("zapier", e.id))).toBe(true);
  });
});

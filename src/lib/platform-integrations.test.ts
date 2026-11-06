import { describe, expect, it } from "vitest";

import { adminText } from "./admin-text";
import { DEFAULT_PLATFORM_EVENTS, isPlatformEvent, PLATFORM_EVENTS, platformSlackMessage } from "./platform-integrations";

const store = { id: "s1", slug: "fjord", name: "Fjord & Co", url: "https://fjord.kaizenstore.site", admin_url: "https://kaizenaflow.com/admin/platform/stores/fjord" };
const text = (payload: Record<string, unknown>) => JSON.stringify(platformSlackMessage(payload));

describe("Kaizena Flow's own events (D465)", () => {
  it("are known by id, and a new connection gets the news an operator acts on", () => {
    expect(PLATFORM_EVENTS.every(isPlatformEvent)).toBe(true);
    expect(isPlatformEvent("order.paid")).toBe(false);
    expect(DEFAULT_PLATFORM_EVENTS.every((event) => PLATFORM_EVENTS.includes(event))).toBe(true);
  });

  it("have words in every language of the admin", () => {
    for (const lang of ["en", "nb"] as const) {
      const words = adminText(lang, "platform").integrations;
      for (const event of PLATFORM_EVENTS) {
        expect(words.events[event]?.label, `${lang} ${event}`).toBeTruthy();
        expect(words.events[event]?.hint, `${lang} ${event}`).toBeTruthy();
      }
    }
  });
});

describe("the Slack message for a platform event", () => {
  it("names a request's person but never their email", () => {
    const message = platformSlackMessage({
      event: "request.received",
      request: { store_name: "Kari Keramikk", name: "Kari", email: "kari@example.com", sells: "Stoneware", admin_url: "https://kaizenaflow.com/admin/platform/requests" },
    });
    expect(message?.text).toBe("New store request: Kari Keramikk");
    expect(JSON.stringify(message)).toContain("From Kari");
    expect(JSON.stringify(message)).not.toContain("kari@example.com");
  });

  it("escapes what stores and people wrote, so it never becomes a mention or a link", () => {
    const sent = text({ event: "store.created", store: { ...store, name: "<!channel> <https://evil.example|Click>" } });
    expect(sent).not.toContain("<!channel>");
    expect(sent).toContain("&lt;!channel&gt;");
    expect(sent).not.toContain("<https://evil.example|");
  });

  it("says a plan's price in whole units and when Stripe is in test mode", () => {
    const sent = text({ event: "plan.started", store, plan: { name: "Pro", amount: 490, currency: "NOK", interval: "month", mode: "test" } });
    expect(sent).toContain("Plan started");
    expect(sent).toContain("(Stripe test mode)");
    expect(sent).toMatch(/490\.00 a month/);
  });

  it("says when a cancelled plan ends, or that it ended", () => {
    expect(text({ event: "plan.cancelled", store, plan: { name: "Pro", status: "active", current_period_end: "2026-12-01T00:00:00.000Z" } })).toContain("ends 2026-12-01");
    expect(text({ event: "plan.cancelled", store, plan: { name: "Pro", status: "canceled" } })).toContain("ended");
  });

  it("gives a notice's category and store, never who sent it or what they wrote", () => {
    const sent = text({
      event: "report.received",
      report: { category: "counterfeit_ip", source: "notice", store: { slug: "fjord", name: "Fjord & Co" }, admin_url: "https://kaizenaflow.com/admin/platform/reports", reporter_email: "r@example.com" },
    });
    expect(sent).toContain("Counterfeit");
    expect(sent).toContain("Fjord &amp; Co");
    expect(sent).not.toContain("r@example.com");
  });

  it("marks a test, and every event has a message", () => {
    expect(platformSlackMessage({ event: "test", test: true, store })?.text).toBe("Test: New store: Fjord &amp; Co");
    for (const event of PLATFORM_EVENTS) {
      expect(platformSlackMessage({ event, store, plan: { name: "Pro" }, request: { store_name: "X" }, report: { category: "other" } }), event).not.toBeNull();
    }
  });
});

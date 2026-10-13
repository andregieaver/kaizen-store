import { describe, expect, it } from "vitest";

import { POLL_STAFF_MS, POLL_VISITOR_MS } from "./support-rules";
import { SAFETY_NET_MS, TYPING_EVERY_MS, isTopic, maySendTyping, readTyping, staffDelay, visitorDelay, widgetListens } from "./support-realtime";

describe("support realtime: the client's choice of delays (D216, 4.6, C17)", () => {
  it("polls at the normal rate without realtime, and at the safety net with it", () => {
    expect(visitorDelay({ status: "open", handler: "queue" }, false, false)).toBe(POLL_VISITOR_MS.waiting);
    expect(visitorDelay({ status: "open", handler: "human" }, false, true)).toBe(SAFETY_NET_MS);
    expect(visitorDelay({ status: "open", handler: "ai" }, false, false)).toBe(POLL_VISITOR_MS.ai);
    expect(visitorDelay({ status: "open", handler: "queue" }, true, false)).toBe(POLL_VISITOR_MS.hidden);
    expect(visitorDelay({ status: "ended", handler: "human" }, false, true)).toBeNull();
    expect(staffDelay("list", false, false)).toBe(POLL_STAFF_MS.list);
    expect(staffDelay("conversation", false, false)).toBe(POLL_STAFF_MS.conversation);
    expect(staffDelay("conversation", false, true)).toBe(SAFETY_NET_MS);
    expect(staffDelay("list", true, false)).toBe(SAFETY_NET_MS);
    expect(SAFETY_NET_MS).toBe(15_000);
  });

  it("listens in the widget only while waiting for or with a person", () => {
    expect(widgetListens({ status: "open", handler: "queue" })).toBe(true);
    expect(widgetListens({ status: "open", handler: "human" })).toBe(true);
    expect(widgetListens({ status: "open", handler: "ai" })).toBe(false);
    expect(widgetListens({ status: "ended", handler: "human" })).toBe(false);
    expect(widgetListens(null)).toBe(false);
  });

  it("says typing at most every 2 seconds, and reads only who, never words", () => {
    expect(maySendTyping(0, TYPING_EVERY_MS)).toBe(true);
    expect(maySendTyping(1000, 1000 + TYPING_EVERY_MS - 1)).toBe(false);
    expect(readTyping({ by: "agent" })).toBe("agent");
    expect(readTyping({ by: "customer", text: "secret" })).toBe("customer");
    expect(readTyping({ by: "someone" })).toBeNull();
    expect(readTyping(null)).toBeNull();
  });

  it("joins only a conversation's or a desk's random topic", () => {
    expect(isTopic(`sc:${"a".repeat(32)}`)).toBe(true);
    expect(isTopic(`sd:${"0".repeat(32)}`)).toBe(true);
    expect(isTopic("sc:short")).toBe(false);
    expect(isTopic(`realtime:sc:${"a".repeat(32)}`)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { conversationRef, feedInput, spokenTurnInput, turnInput } from "./support-visitor-schema";
import { lastSeqOf, mergeMessages, pollDelay, readStored, storedValue, STORED_MESSAGES, type VisitorMessage } from "./support-visitor";

const ref = { id: "6f1e4c2a-1b2c-4d3e-8f90-123456789abc", token: "tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345" };
const message = (seq: number, author: VisitorMessage["author"] = "customer"): VisitorMessage => ({ seq, author, body: `m${seq}`, at: "2026-10-13T12:00:00.000Z" });

describe("the tab's copy of its conversation (D216, kaizen_chat v2)", () => {
  it("reads back what it wrote, for the same site only", () => {
    const stored = { v: 2 as const, site: "demo/no", conversation: ref, lastSeq: 2, status: "open" as const, messages: [message(1), message(2, "ai")] };
    const raw = storedValue(stored);
    expect(readStored(raw, "demo/no")).toEqual(stored);
    expect(readStored(raw, "other/no").conversation).toBeNull();
  });

  it("drops the old version (v1 held the whole conversation), a broken value and a reference that is not one", () => {
    expect(readStored(JSON.stringify({ site: "demo/no", messages: [{ role: "user", content: "Hei" }] }), "demo/no")).toMatchObject({ conversation: null, messages: [] });
    expect(readStored("{not json", "demo/no").conversation).toBeNull();
    expect(readStored(JSON.stringify({ v: 2, site: "demo/no", conversation: { id: "x", token: "y" }, messages: [] }), "demo/no").conversation).toBeNull();
    expect(readStored(null, "demo/no")).toMatchObject({ v: 2, conversation: null, lastSeq: 0, status: "open" });
  });

  it("keeps at most the last 40 messages, and only messages it can draw", () => {
    const many = Array.from({ length: 50 }, (_, i) => message(i + 1));
    const raw = storedValue({ v: 2, site: "", conversation: ref, lastSeq: 50, status: "open", messages: many });
    const back = readStored(raw, "");
    expect(back.messages).toHaveLength(STORED_MESSAGES);
    expect(back.messages[0].seq).toBe(11);
    const odd = JSON.stringify({ v: 2, site: "", conversation: ref, lastSeq: 1, status: "ended", messages: [message(1), { seq: 2, author: "note", body: "x", at: "" }] });
    expect(readStored(odd, "").messages.map((m) => m.seq)).toEqual([1]);
    expect(readStored(odd, "").status).toBe("ended");
  });

  it("merges by number, in order, never twice", () => {
    const merged = mergeMessages([message(1), message(2, "ai")], [message(3), message(2, "ai")]);
    expect(merged.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(lastSeqOf(merged)).toBe(3);
    expect(lastSeqOf([], 7)).toBe(7);
  });

  it("asks sooner while a person may answer, rarely in a hidden tab, never once ended", () => {
    expect(pollDelay({ status: "open", handler: "ai" }, false)).toBe(10_000);
    expect(pollDelay({ status: "open", handler: "queue" }, false)).toBe(3000);
    expect(pollDelay({ status: "open", handler: "human" }, true)).toBe(15_000);
    expect(pollDelay({ status: "ended", handler: "ai" }, false)).toBeNull();
  });
});

describe("the visitor routes' input", () => {
  it("takes only the new message and the conversation's reference", () => {
    expect(turnInput.safeParse({ message: "Hei", conversation: ref, after: 4 }).success).toBe(true);
    expect(turnInput.safeParse({ message: "Hei" }).data?.after).toBe(0);
    expect(turnInput.safeParse({ message: "" }).success).toBe(false);
    expect(turnInput.safeParse({ message: "x".repeat(1001) }).success).toBe(false);
    expect(turnInput.safeParse({ message: "Hei", path: "https://elsewhere.example" }).success).toBe(false);
    expect(spokenTurnInput.safeParse({ conversation: ref }).success).toBe(true);
  });

  it("refuses a reference that is not an id and a token", () => {
    expect(conversationRef.safeParse(ref).success).toBe(true);
    expect(conversationRef.safeParse({ id: ref.id, token: "short" }).success).toBe(false);
    expect(feedInput.safeParse({ conversation: { id: "1", token: ref.token } }).success).toBe(false);
  });
});

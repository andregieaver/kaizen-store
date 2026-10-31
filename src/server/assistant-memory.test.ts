import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { readLearned } = await import("./assistant-memory");

const said = (...contents: string[]) => JSON.stringify({ memories: contents.map((content) => ({ kind: "preference", content })) });

/** What the AI manager may keep from a conversation (D103, PSI AGT-07): how the person works, never a customer's details or numbers. */
describe("what the AI manager keeps", () => {
  it("keeps how the person works", () => {
    expect(readLearned(said("Writes product texts in Norwegian, short and warm", "Ships on Tuesdays and Fridays")).map((m) => m.content)).toEqual([
      "Writes product texts in Norwegian, short and warm",
      "Ships on Tuesdays and Fridays",
    ]);
    expect(readLearned(said("Opening hours 09-17, 3 staff")).length).toBe(1);
  });

  it("never keeps contact details, identity numbers, card or account numbers", () => {
    for (const content of [
      "Kari's email is kari@example.no",
      "Call the supplier on +47 912 34 567",
      "Her number is 91 23 45 67",
      "Card 4242424242424242 was used",
      "Account 15030123456 for payouts",
      "Customer id 010190-12345 asked for a refund",
      "Pay into NO93 8601 1117 947",
      "The admin passord is hemmelig",
    ]) {
      expect([content, readLearned(said(content)).length]).toEqual([content, 0]);
    }
  });
});

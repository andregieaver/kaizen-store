import { afterEach, describe, expect, it, vi } from "vitest";

import { UNTRUSTED_TEXT } from "@/lib/prompt-safety";

vi.mock("server-only", () => ({}));

const { readReceipt } = await import("./receipt-reading");

import type { AiConnection } from "./ai";

type Row = Record<string, unknown>;

/** A provider's key and models, as the store's model that sees pictures, with no usage to record. */
const connection = {
  storeId: null,
  provider: "openai",
  baseUrl: null,
  apiUrl: "https://ai.example/v1",
  apiKey: "sk-test",
  textModel: "text-model",
  visionModel: "vision-model",
  textEuOnly: false,
  source: "platform",
} as unknown as AiConnection;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF = new TextEncoder().encode("%PDF-1.7\n");

/** The provider answers with `answer` (or fails) and keeps what it was sent. */
function provider(answer: string | null) {
  const sent: Row[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (!String(url).endsWith("/chat/completions")) return new Response("{}", { status: 404 });
      sent.push(JSON.parse(String(init.body)) as Row);
      if (answer === null) return new Response("down", { status: 500 });
      return Response.json({ choices: [{ message: { content: answer } }] });
    }),
  );
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a receipt read by the store's model (B3 step 2, D491)", () => {
  it("sends the photo as data to the model that sees pictures, with the rule that it is data, and reads the answer", async () => {
    const sent = provider('{"supplier": "Clas Ohlson AS", "date": "2027-01-25", "currency": "NOK", "total": 1000, "vat": [{"rate": 25, "amount": 200}], "kind": "office"}');
    expect(await readReceipt("store", "account", JPEG, "NOK", { connection })).toEqual({
      ok: true,
      reading: { supplier: "Clas Ohlson AS", day: "2027-01-25", currency: "NOK", totalMinor: 100_000, kind: "office", vatRate: 25 },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].model).toBe("vision-model");
    const [system, user] = sent[0].messages as { role: string; content: unknown }[];
    expect(system.role).toBe("system");
    expect(String(system.content)).toContain(UNTRUSTED_TEXT);
    const parts = user.content as { type: string; image_url?: { url: string } }[];
    expect(parts[1].image_url?.url.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("reads nothing that is no picture the model takes, nothing without a model, and says so when the model fails or answers out of shape", async () => {
    const sent = provider("{}");
    expect(await readReceipt("store", "account", PDF, "NOK", { connection })).toEqual({ ok: false, reason: "not_a_picture" });
    expect(await readReceipt("store", "account", JPEG, "NOK", { connection: null })).toEqual({ ok: false, reason: "no_ai" });
    expect(sent).toHaveLength(0);
    provider(null);
    expect(await readReceipt("store", "account", JPEG, "NOK", { connection })).toEqual({ ok: false, reason: "unread" });
    provider("Sorry, I cannot help with that.");
    expect(await readReceipt("store", "account", JPEG, "NOK", { connection })).toEqual({ ok: false, reason: "unread" });
  });
});

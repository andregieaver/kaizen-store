import { afterEach, describe, expect, it, vi } from "vitest";

import { UNTRUSTED_TEXT } from "@/lib/prompt-safety";

vi.mock("server-only", () => ({}));

const { readBill } = await import("./bill-reading");

import type { AiConnection } from "./ai";

type Row = Record<string, unknown>;

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

/** A one-page PDF whose page says `words`, written out by hand (as a supplier's invoice with a text layer). */
function pdfWith(words: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${words}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

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

const ANSWER = '{"supplier": "Telenor Norge AS", "invoiceNumber": "88123", "date": "2027-01-10", "dueDate": "2027-01-24", "currency": "NOK", "total": 1250, "vat": [{"rate": 25, "amount": 250}], "kind": "phone"}';

describe("a supplier's invoice read by the store's model (B3, D493)", () => {
  it("sends a PDF's text to the text model, framed as data, and reads the answer into the form", async () => {
    const sent = provider(ANSWER);
    const read = await readBill("store", "account", pdfWith("Telenor Norge AS Faktura 88123 Aa betale 1 250,00"), "NOK", { connection });
    expect(read).toMatchObject({ ok: true, reading: { supplier: "Telenor Norge AS", number: "88123", totalMinor: 125_000, kind: "phone", vatRate: 25, dueOn: "2027-01-24" } });
    expect(sent[0].model).toBe("text-model");
    const [system, user] = sent[0].messages as { role: string; content: unknown }[];
    expect(String(system.content)).toContain(UNTRUSTED_TEXT);
    expect(typeof user.content).toBe("string");
    expect(String(user.content)).toContain("[invoice text]");
    expect(String(user.content)).toContain("Faktura 88123");
  });

  it("sends a photo to the model that sees pictures", async () => {
    const sent = provider(ANSWER);
    expect(await readBill("store", "account", JPEG, "NOK", { connection })).toMatchObject({ ok: true });
    expect(sent[0].model).toBe("vision-model");
    const parts = (sent[0].messages as { content: unknown }[])[1].content as { type: string }[];
    expect(parts.map((p) => p.type)).toEqual(["text", "image_url"]);
  });

  it("reads nothing from a PDF with no text, a file that is no bill, or without a model, and says so when the model fails", async () => {
    const sent = provider(ANSWER);
    expect(await readBill("store", "account", pdfWith(""), "NOK", { connection })).toEqual({ ok: false, reason: "not_readable" });
    expect(await readBill("store", "account", new TextEncoder().encode("hello"), "NOK", { connection })).toEqual({ ok: false, reason: "not_readable" });
    expect(await readBill("store", "account", JPEG, "NOK", { connection: null })).toEqual({ ok: false, reason: "no_ai" });
    expect(sent).toHaveLength(0);
    provider(null);
    expect(await readBill("store", "account", JPEG, "NOK", { connection })).toEqual({ ok: false, reason: "unread" });
  });
});

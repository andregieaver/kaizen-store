import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const completeText = vi.fn();
class AiError extends Error {}
vi.mock("./ai", () => ({ AiError, completeText }));

const { planPageMotion, motionMessages, motionSystemPrompt } = await import("./motion-ai");
const { outlinePage } = await import("@/lib/motion-plan");
const { ENTER_IDS, HOVER_IDS, SCROLL_IDS, BACKGROUND_IDS } = await import("@/lib/motion");

import type { PageRow } from "@/lib/page-content";

const connection = { textModel: "m", source: "platform" } as never;
const noText = { textModel: null, source: "platform" } as never;

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const rows = [
  {
    id: "hero",
    type: "row",
    layout: "1",
    columns: [
      {
        id: "hero-c",
        blocks: [
          { id: "h1", type: "heading", text: "Handmade ceramics — write to owner@shop.example", level: 1 },
          {
            id: "lead",
            type: "richText",
            doc: doc("Visit https://shop.example/secret?token=abc or call +47 900 00 000. Only 199 kr!"),
          },
          { id: "cta", type: "button", label: "Buy now", href: "https://checkout.example/private" },
        ],
      },
    ],
  },
  {
    id: "cards",
    type: "row",
    layout: "3",
    columns: [1, 2, 3].map((i) => ({
      id: `card-${i}`,
      blocks: [{ id: `card-${i}-h`, type: "heading", text: `Card ${i}`, level: 3 }],
    })),
  },
  {
    id: "form",
    type: "row",
    layout: "1",
    columns: [
      {
        id: "form-c",
        blocks: [
          {
            id: "signup",
            type: "emailForm",
            recipients: ["secret@owner.example"],
            subject: "",
            fields: [],
            submitLabel: "",
            successMessage: "",
          },
        ],
      },
    ],
  },
] as unknown as PageRow[];

beforeEach(() => completeText.mockReset());

describe("planPageMotion", () => {
  it("asks the model once with the outline and uses its plan, checked", async () => {
    completeText.mockResolvedValue({
      text: 'Sure! ```json\n{"style":"lively","summary":"<b>Wow</b>","items":[{"id":"h1","enter":{"effect":"words","stagger":60}},{"id":"cta","hover":{"effect":"magnetic"}},{"id":"cards","enter":{"effect":"pop","stagger":120}}]}\n```',
      region: null,
    });
    const result = await planPageMotion(connection, rows);
    expect(completeText).toHaveBeenCalledTimes(1);
    const [used, messages, options] = completeText.mock.calls[0];
    expect(used).toBe(connection);
    expect(messages[0].role).toBe("system");
    expect(options).toMatchObject({ temperature: 0.2, maxTokens: expect.any(Number), timeoutMs: expect.any(Number) });
    expect(result.ok && result.plan.aiUsed).toBe(true);
    if (!result.ok) throw new Error("expected a plan");
    expect(result.plan.style).toBe("lively");
    expect(result.plan.items.map((i) => i.id)).toEqual(["h1", "cta", "cards"]);
    // The words the owner reads are the code's own.
    expect(result.plan.summary).not.toContain("Wow");
    expect(result.plan.summary).not.toContain("<");
  });

  it("falls back to the rules on junk, on an answer with no real ids, and on an empty answer", async () => {
    for (const text of [
      "I cannot do that.",
      '{"style":"elegant","items":[{"id":"ghost","enter":{"effect":"fade-up"}}]}',
      '{"items":[{"id":"hero","enter":{"effect":"nope"}}]}',
      "{}",
    ]) {
      completeText.mockResolvedValueOnce({ text, region: null });
      const result = await planPageMotion(connection, rows);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan.aiUsed).toBe(false);
        expect(result.plan.items.length).toBeGreaterThan(0);
      }
    }
  });

  it("falls back to the rules when the model fails, whatever the failure", async () => {
    completeText.mockRejectedValueOnce(new AiError("down"));
    completeText.mockRejectedValueOnce(new TypeError("odd"));
    for (let i = 0; i < 2; i++) {
      const result = await planPageMotion(connection, rows);
      expect(result).toMatchObject({ ok: true, plan: { aiUsed: false } });
    }
  });

  it("uses the rules without asking when there is no connection or no text model", async () => {
    for (const none of [null, noText]) {
      const result = await planPageMotion(none, rows);
      expect(result).toMatchObject({ ok: true, plan: { aiUsed: false, style: "elegant" } });
    }
    expect(completeText).not.toHaveBeenCalled();
  });

  it("does not ask about a page with nothing on it", async () => {
    const result = await planPageMotion(connection, []);
    expect(completeText).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, plan: { aiUsed: false, items: [] } });
  });

  it("is the same rules' plan every time", async () => {
    expect(await planPageMotion(null, rows)).toEqual(await planPageMotion(null, rows));
  });
});

describe("what the model sees", () => {
  const sent = motionMessages(outlinePage(rows))[1].content as string;

  it("holds structure and headline words, never addresses, emails, phone numbers, prices or button and form data", () => {
    for (const secret of [
      "owner@shop",
      "shop.example",
      "secret",
      "checkout.example",
      "+47",
      "900 00",
      "199",
      "Buy now",
      "recipients",
      "token",
    ]) {
      expect(sent).not.toContain(secret);
    }
    expect(sent).toContain("Handmade ceramics");
    expect(sent).toContain('"id":"cards"');
    expect(sent).toContain('"firstRow":true');
    expect(sent).toContain("emailForm");
  });

  it("names every effect the schemas accept, and says how to answer", () => {
    const prompt = motionSystemPrompt();
    for (const id of [...ENTER_IDS, ...HOVER_IDS, ...SCROLL_IDS, ...BACKGROUND_IDS]) expect(prompt).toContain(id);
    expect(prompt).toContain("JSON only");
    expect(prompt).toContain("ONLY the effect ids");
    expect(prompt).toContain("firstRow");
    expect(prompt).toMatch(/text effects|only on text/);
  });
});

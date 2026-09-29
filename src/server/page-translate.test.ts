import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const audit = vi.fn(async () => {});
vi.mock("./auth", () => ({ audit }));
const completeText = vi.fn();
class AiError extends Error {}
vi.mock("./ai", () => ({ AiError, completeText }));

const { translatePageTexts } = await import("./page-translate");

const connection = { textModel: "m", source: "platform" } as never;
const who = { accountId: "a", storeId: "s" };
const request = {
  from: "Norwegian",
  to: "Swedish",
  items: [
    { key: "title", label: "Title", max: 200, rich: false, runs: ["Om oss"] },
    { key: "seo.description", label: "Search description", max: 160, rich: false, runs: ["Vår historie"] },
  ],
};

beforeEach(() => {
  completeText.mockReset();
  audit.mockClear();
});

describe("translatePageTexts", () => {
  it("asks the model, checks its answer and logs the run without the texts", async () => {
    completeText.mockResolvedValue({ text: 'Here you go: {"t0": "Om oss", "t1": "Vår historia"}', region: null });
    const result = await translatePageTexts(connection, who, request);
    expect(result.done).toEqual({ title: "Om oss", "seo.description": "Vår historia" });
    expect(result.model).toBe("m");
    expect(JSON.stringify(audit.mock.calls)).not.toContain("historia");
  });

  it("leaves out what the model could not do, and fails when it answers nothing", async () => {
    completeText.mockResolvedValueOnce({ text: '{"t0": "Om oss"}', region: null });
    const partial = await translatePageTexts(connection, who, request);
    expect(partial.skipped.map((s) => s.key)).toEqual(["seo.description"]);

    completeText.mockRejectedValue(new AiError("down"));
    await expect(translatePageTexts(connection, who, request)).rejects.toThrow("down");
  });

  it("refuses a page with too much text", async () => {
    const big = { ...request, items: [{ key: "k", label: "k", max: 0, rich: true, runs: Array.from({ length: 30 }, () => "x".repeat(5000)) }] };
    await expect(translatePageTexts(connection, who, big)).rejects.toThrow("too much text");
  });
});

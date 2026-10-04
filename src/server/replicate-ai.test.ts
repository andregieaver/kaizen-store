import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const calls: { maxTokens?: number; reasoningEffort?: string }[] = [];
let answers: (string | Error)[] = [];

vi.mock("./ai", () => {
  class AiError extends Error {
    constructor(
      message: string,
      public status: number | null = null,
    ) {
      super(message);
    }
  }
  return {
    AiError,
    imagePart: () => ({ type: "image_url", image_url: "x" }),
    completeText: async (_c: unknown, _m: unknown, options: { maxTokens?: number; reasoningEffort?: string }) => {
      calls.push({ maxTokens: options.maxTokens, reasoningEffort: options.reasoningEffort });
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return { text: next ?? "", region: null };
    },
  };
});

const { replyWithRoom } = await import("./replicate-ai");
const { AiError } = await import("./ai");

const opts = { maxTokens: 1000, temperature: 0.2, timeoutMs: 1000 };

describe("a reply with room to think (lampan.no: the AI's answer was cut off at its length limit)", () => {
  beforeEach(() => {
    calls.length = 0;
    answers = [];
  });

  it("asks for low reasoning effort at the given limit", async () => {
    answers = ["{}"];
    await expect(replyWithRoom({} as never, [], opts)).resolves.toEqual({ text: "{}", region: null });
    expect(calls).toEqual([{ maxTokens: 1000, reasoningEffort: "low" }]);
  });

  it("asks once more with three times the room when the answer was cut off", async () => {
    answers = [new AiError("The answer was cut off at its length limit."), "{\"ok\":true}"];
    await expect(replyWithRoom({} as never, [], opts)).resolves.toMatchObject({ text: "{\"ok\":true}" });
    expect(calls.map((c) => c.maxTokens)).toEqual([1000, 3000]);
  });

  it("gives up after that second try", async () => {
    answers = [new AiError("The answer was cut off at its length limit."), new AiError("The answer was cut off at its length limit.")];
    await expect(replyWithRoom({} as never, [], opts)).rejects.toThrow(/cut off/);
    expect(calls).toHaveLength(2);
  });

  it("does not repeat a request for any other failure", async () => {
    answers = [new AiError("Invalid model", 400)];
    await expect(replyWithRoom({} as never, [], opts)).rejects.toThrow("Invalid model");
    expect(calls).toHaveLength(1);
  });
});

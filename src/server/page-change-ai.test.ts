import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { changePrompt, readChangePlan } = await import("./page-change-ai");
const { UNTRUSTED_TEXT } = await import("@/lib/prompt-safety");
const { newPageContent } = await import("@/lib/page-content");

describe("Change with AI's plan (D351)", () => {
  it("reads only changes the edit tool takes, leaving a new section's pictures to the person", () => {
    const plan = readChangePlan(
      'Here you go: {"changes":[{"do":"set_text","key":"title","text":"Hello"},{"do":"add_section","pattern":"text","name":"Hours","brief":"Our opening hours","picture":{"prompt":"a shop front in the morning light","alt":"Shop"}}]}',
    );
    expect(plan).toEqual([
      { do: "set_text", key: "title", text: "Hello" },
      expect.objectContaining({ do: "add_section", pattern: "text", name: "Hours", picture: undefined, pictures: undefined }),
    ]);
    expect(readChangePlan("no json here")).toBeNull();
    expect(readChangePlan('{"changes":[{"do":"write_css","css":"body{}"}]}')).toBeNull();
    expect(readChangePlan('{"changes":[]}')).toBeNull();
  });

  it("gives the model the page as data, the site's own links and the rule about untrusted text", () => {
    const prompt = changePrompt({ ...newPageContent(), title: "Welcome" }, [{ href: "/products", label: "Products" }]);
    expect(prompt).toContain(UNTRUSTED_TEXT);
    expect(prompt).toContain("<page-data>");
    expect(prompt).toContain("/products");
    expect(prompt).toContain("never invent a part, a style, CSS or script");
  });
});

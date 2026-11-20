import { describe, expect, it } from "vitest";

import { contentTexts, personalize, personalizeContent, tokenProblems } from "./personal-fields";

describe("personal fields with a fallback (M2.6)", () => {
  it("fill the reader's first name and company, or the fallback, and every fallback without a reader", () => {
    const anna = { name: "Anna Berg", company: "Berg AS" };
    expect(personalize("Hi {first_name|there}, news for {company|your team}.", anna)).toBe("Hi Anna, news for Berg AS.");
    expect(personalize("Hi {first_name|there}, news for {company|your team}.", { name: "", company: " " })).toBe("Hi there, news for your team.");
    expect(personalize("Hi {first_name|there}", null)).toBe("Hi there");
    expect(personalize("A brace {left} alone and {unknown|x}", anna)).toBe("A brace {left} alone and {unknown|x}");
  });

  it("refuse a field without a fallback and one the store does not have", () => {
    expect(tokenProblems("Hi {first_name}")).toEqual([{ kind: "no_fallback", field: "first_name" }]);
    expect(tokenProblems("Hi {first_name| }")).toEqual([{ kind: "no_fallback", field: "first_name" }]);
    expect(tokenProblems("Hi {nickname|you}")).toEqual([{ kind: "unknown", field: "nickname" }]);
    expect(tokenProblems("Hi {first_name|there} and {company|you}")).toEqual([]);
  });

  it("fill a language's subject, preview and words, and leave other blocks as they are", () => {
    const content = {
      subject: "{first_name|Hi}",
      preview: "",
      blocks: [{ type: "paragraph" as const, text: "Dear {first_name|friend}" }, { type: "divider" as const }],
    };
    const out = personalizeContent(content, { name: "Ola", company: "" });
    expect(out.subject).toBe("Ola");
    expect(out.blocks).toEqual([{ type: "paragraph", text: "Dear Ola" }, { type: "divider" }]);
    expect(contentTexts(content)).toEqual(["{first_name|Hi}", "", "Dear {first_name|friend}"]);
  });
});

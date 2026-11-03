import { describe, expect, it } from "vitest";

import { highlightCode, knownCodeLanguage } from "./docs-highlight";

const tagged = (code: string, lang: string) => highlightCode(code, lang).filter((t) => t.tag).map((t) => [t.tag, t.text]);

describe("code in the docs, coloured (D442)", () => {
  it("gives back the code exactly, in every language", () => {
    const samples: [string, string][] = [
      ["json", '{ "data": [{ "id": 1, "ok": true, "x": null }], "next": "abc" }'],
      ["bash", 'curl https://kaizenaflow.com/api/admin/v1/products?limit=10 \\\n  -H "Authorization: Bearer $KAIZENA_TOKEN" # list'],
      ["ts", "const sig = `v1=${hex}`; // check\nif (a === 'b') return await verify(body, 300);"],
      ["python", 'def ok(body):\n    return hmac.new(b"key", body, "sha256")  # sign'],
      ["php", '<?php $ok = hash_hmac("sha256", $body, $secret); // sign'],
      ["http", 'POST /api/admin/v1/products HTTP/1.1\nIdempotency-Key: abc\n\n{"a": 1}'],
      ["yaml", "title: Hello # c\nareas: [a, b]\norder: 40"],
      ["text", "<b>plain</b>"],
    ];
    for (const [lang, code] of samples) expect(highlightCode(code, lang).map((t) => t.text).join(""), lang).toBe(code);
  });

  it("tells keys, strings, numbers, literals and comments apart", () => {
    expect(tagged('{ "id": 1, "ok": true }', "json")).toEqual([
      ["punctuation", "{"],
      ["property", '"id"'],
      ["punctuation", ":"],
      ["number", "1"],
      ["punctuation", ","],
      ["property", '"ok"'],
      ["punctuation", ":"],
      ["literal", "true"],
      ["punctuation", "}"],
    ]);
    expect(tagged('curl -H "A: b" $TOKEN # note', "bash")).toEqual([
      ["keyword", "curl"],
      ["property", "-H"],
      ["string", '"A: b"'],
      ["literal", "$TOKEN"],
      ["comment", "# note"],
    ]);
    expect(tagged("const a = 'x'; // c", "js")).toEqual([
      ["keyword", "const"],
      ["punctuation", "="],
      ["string", "'x'"],
      ["punctuation", ";"],
      ["comment", "// c"],
    ]);
  });

  it("leaves a language it does not colour as one plain piece, and knows its fences", () => {
    expect(highlightCode("SELECT 1", "sql")).toEqual([{ tag: null, text: "SELECT 1" }]);
    expect(highlightCode("", "json")).toEqual([]);
    expect(knownCodeLanguage("TS")).toBe(true);
    expect(knownCodeLanguage("text")).toBe(true);
    expect(knownCodeLanguage("cobol")).toBe(false);
  });
});

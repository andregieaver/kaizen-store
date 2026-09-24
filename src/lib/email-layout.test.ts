import { describe, expect, it } from "vitest";

import { escapeHtml, renderEmail } from "./email-layout";

describe("renderEmail", () => {
  const email = renderEmail({
    subject: "Ordre 1001",
    preview: "Takk!",
    lang: "nb",
    footer: ["Kopp <AS>", "Storgata 1"],
    blocks: [
      { type: "heading", text: "Takk for bestillingen!" },
      { type: "paragraph", text: "Linje 1\nLinje 2 <script>" },
      { type: "lines", rows: [{ label: "1 × Kopp", value: "249,00 kr" }, { label: "Totalt", value: "348,00 kr", strong: true }] },
      { type: "button", text: "Se bestillingen", url: "https://x.test/o?a=1&b=2" },
      { type: "code", text: "123456" },
    ],
  });

  it("escapes what shoppers and owners typed, and keeps line breaks", () => {
    expect(email.html).toContain("Linje 1<br>Linje 2 &lt;script&gt;");
    expect(email.html).toContain("Kopp &lt;AS&gt;");
    expect(email.html).toContain('href="https://x.test/o?a=1&amp;b=2"');
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain('<html lang="nb">');
  });

  it("has a plain text version with the same content", () => {
    expect(email.text).toContain("Takk for bestillingen!");
    expect(email.text).toContain("Totalt: 348,00 kr");
    expect(email.text).toContain("Se bestillingen: https://x.test/o?a=1&b=2");
    expect(email.text).toContain("123456");
    expect(email.text.trimEnd().endsWith("Storgata 1")).toBe(true);
  });

  it("escapes quotes", () => {
    expect(escapeHtml(`"a" 'b'`)).toBe("&quot;a&quot; &#39;b&#39;");
  });
});

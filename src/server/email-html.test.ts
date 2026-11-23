import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { cleanEmailHtml } = await import("./email-html");

describe("an email's own HTML (M4.1)", () => {
  it("keeps text, tables, links and pictures with their look", () => {
    const { html, text, pictures } = cleanEmailHtml(
      '<table width="100%" cellpadding="0"><tr><td style="padding:12px;color:#171717;background-color:#f5f5f4">Hei &amp; velkommen<br><a href="https://shop.example/p/ull">Se ulla</a></td></tr></table><img src="https://cdn.example/a.jpg" alt="Ull" width="200">',
    );
    expect(html).toContain('<td style="padding:12px;color:#171717;background-color:#f5f5f4">');
    expect(html).toContain('<a href="https://shop.example/p/ull" target="_blank">Se ulla</a>');
    expect(html).toMatch(/<img [^>]*src="https:\/\/cdn\.example\/a\.jpg"/);
    expect(html).toContain('alt="Ull"');
    expect(pictures).toEqual(["https://cdn.example/a.jpg"]);
    expect(text).toContain("Hei & velkommen");
    expect(text).toContain("Se ulla: https://shop.example/p/ull");
  });

  it("removes everything that runs, every outside address it may not keep, and words inside removed scripts", () => {
    const { html, text, pictures } = cleanEmailHtml(
      [
        '<script>alert(1)</script><style>p{color:red}</style>',
        '<p onclick="steal()" class="x" id="y" style="color:red;position:fixed;background:url(https://evil.example/t.gif)">Hi</p>',
        '<a href="javascript:alert(1)">bad</a><a href="//evil.example">rel</a><a href="http://plain.example">http</a><a href="mailto:post@example.com">mail</a>',
        '<img src="http://evil.example/t.gif"><img src="data:image/png;base64,AAAA"><img src=x onerror=alert(1)>',
        '<iframe src="https://evil.example"></iframe><form action="https://evil.example"><input name="card"></form><svg><script>1</script></svg>',
      ].join(""),
    );
    for (const gone of ["<script", "alert", "<style", "onclick", "class=", "id=", "position", "url(", "javascript:", "evil.example", "http://", "<iframe", "<form", "<input", "<svg", "onerror", "data:"])
      expect(html).not.toContain(gone);
    expect(html).toContain('<p style="color:red">Hi</p>');
    expect(html).toContain('<a href="mailto:post@example.com" target="_blank">mail</a>');
    expect(pictures).toEqual([]);
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color:red");
  });
});

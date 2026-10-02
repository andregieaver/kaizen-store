import { describe, expect, it } from "vitest";

import { findClaims } from "./claims";
import {
  EMPTY_BRIEF,
  EMPTY_COPY,
  PATTERNS,
  availablePatterns,
  buildPage,
  checkPlan,
  copyClaims,
  copyMessages,
  copyWithoutClaims,
  interviewMessages,
  pagePlan,
  picturePrompt,
  planMessages,
  readCopy,
  readInterviewReply,
  readPlan,
  uniqueSlug,
  withoutClaims,
  type PagePlan,
  type SectionCopy,
  type SiteFacts,
} from "./page-ai";
import { blockHasContent, pageBlocks, pageInput, RESERVED_STORE_PAGE_SLUGS, ROW_LAYOUTS, type PageBlock } from "./page-content";

const facts: SiteFacts = {
  kind: "store",
  name: "Kaffebrenneriet",
  language: { locale: "nb-NO", name: "Norwegian Bokmål" },
  about: "Kaffe brent i Bergen.",
  audience: "consumers",
  contact: { email: "post@kaffe.no", address: null },
  links: [
    { label: "Front page", href: "/s/kaffe/no" },
    { label: "All products", href: "/s/kaffe/no/products" },
    { label: "Category: Espresso", href: "/s/kaffe/no/category/espresso" },
    { label: "Page: Om oss", href: "/s/kaffe/no/om-oss" },
    { label: "Email", href: "mailto:post@kaffe.no" },
  ],
  products: [{ title: "Espresso Bergen", href: "/s/kaffe/no/p/espresso-bergen", summary: "Mørk brent, sjokoladeaktig." }],
  productCategories: [{ id: "8f2b1c0e-4b1a-4c55-9f7e-2a6b0a1f0c11", name: "Espresso", slug: "espresso" }],
  tint: "#f4f1ec",
  can: { pictures: true, productGrid: true, articleGrid: false, googleReviews: false },
};

let n = 0;
const newId = () => `id${++n}`;
const pic = (what: string) => ({ prompt: `A photo of ${what}, soft daylight, realistic.`, alt: `Bilde av ${what}` });

const plan = (sections: unknown[], extra: Record<string, unknown> = {}): PagePlan =>
  pagePlan.parse({ title: "Vår kaffe", slug: "var-kaffe", description: "Kaffe fra Bergen.", sections, ...extra });

const copy = (fields: Partial<SectionCopy>): SectionCopy => ({ ...EMPTY_COPY, ...fields });

describe("the interview", () => {
  it("reads the model's message, brief and readiness, and keeps the brief when it answers in plain words", () => {
    const reply = readInterviewReply(
      'Here you go: {"message": "Hvem er siden for?", "ready": false, "brief": {"title": "Om kaffen", "facts": ["Brenner hver tirsdag", 42], "tone": "varm"}}',
      EMPTY_BRIEF,
    );
    expect(reply).toMatchObject({ message: "Hvem er siden for?", ready: false, brief: { title: "Om kaffen", facts: ["Brenner hver tirsdag"], tone: "varm", purpose: "" } });
    expect(readInterviewReply("Hva skal siden handle om?", reply.brief)).toEqual({ message: "Hva skal siden handle om?", brief: reply.brief, ready: false });
  });

  it("tells the model the site's facts, the rules and what the page can have", () => {
    const [system, ...rest] = interviewMessages(facts, EMPTY_BRIEF, [{ role: "user", content: "Jeg vil ha en side om kaffen vår" }]);
    expect(system.content).toContain("Kaffebrenneriet");
    expect(system.content).toContain("Espresso Bergen: Mørk brent, sjokoladeaktig.");
    expect(system.content).toContain("Never invent facts");
    expect(system.content).toContain("products");
    expect(system.content).not.toContain("articles");
    expect(rest).toEqual([{ role: "user", content: "Jeg vil ha en side om kaffen vår" }]);
  });
});

describe("the plan", () => {
  it("is read from the model's answer, leaving out sections it does not know", () => {
    const read = readPlan(`\`\`\`json\n${JSON.stringify({ title: "Kaffe", sections: [{ pattern: "hero", name: "Åpning" }, { pattern: "carousel3d", name: "?" }] })}\n\`\`\``);
    expect(read).toMatchObject({ ok: true, plan: { title: "Kaffe", sections: [{ pattern: "hero", name: "Åpning" }] } });
    expect(readPlan("no plan")).toEqual({ ok: false, problem: "The answer was not JSON." });
    expect(readPlan('{"title": "x", "sections": [{"pattern": "nope", "name": "?"}]}').ok).toBe(false);
  });

  it("is checked: one opening, first; designs, links, videos and pictures only as the site allows", () => {
    const planned = plan([
      { pattern: "text", name: "Historien", links: ["/s/kaffe/no/om-oss", "https://elsewhere.example/buy"] },
      { pattern: "hero", variant: "split-right", name: "Åpning", picture: pic("a coffee roaster") },
      { pattern: "hero", name: "Another opening" },
      { pattern: "articles", name: "Blogg" },
      { pattern: "video", name: "Film", video: "https://youtu.be/dQw4w9WgXcQ" },
      { pattern: "products", name: "Utvalg", category: "filter" },
      { pattern: "textImage", name: "Brenneriet" },
    ]);
    const { plan: checked, notes } = checkPlan(planned, facts, "Jeg vil ha en side om kaffen vår");
    expect(checked.sections.map((s) => [s.pattern, s.name])).toEqual([
      ["hero", "Åpning"],
      ["text", "Historien"],
      ["products", "Utvalg"],
      ["text", "Brenneriet"],
    ]);
    expect(checked.sections[1].links).toEqual(["/s/kaffe/no/om-oss"]);
    expect(checked.sections[2].category).toBeUndefined();
    expect(notes).toEqual([
      '"Historien": left out a link to https://elsewhere.example/buy, which is not an address on the site.',
      'Left out "Another opening": a page has one opening.',
      'Left out "Blogg": the site has no articles to show.',
      'Left out "Film": a video needs a YouTube or Vimeo address you gave.',
      '"Utvalg": shows all products, as the store has no category "filter".',
    ]);
    // A video the owner gave the address of stays.
    const withVideo = checkPlan(plan([{ pattern: "video", name: "Film", video: "https://youtu.be/dQw4w9WgXcQ" }]), facts, "Se https://youtu.be/dQw4w9WgXcQ");
    expect(withVideo.plan.sections).toHaveLength(1);
  });

  it("makes no pictures where the site's AI cannot, and at most eight", () => {
    const noPictures = { ...facts, can: { ...facts.can, pictures: false } };
    const { plan: checked } = checkPlan(plan([{ pattern: "hero", variant: "split-left", name: "Åpning", picture: pic("beans") }, { pattern: "gallery", name: "Bilder", pictures: [pic("a"), pic("b")] }]), noPictures, "");
    expect(checked.sections).toEqual([expect.objectContaining({ pattern: "hero", variant: "centered", picture: undefined })]);
    const many = checkPlan(
      plan(Array.from({ length: 4 }, (_, i) => ({ pattern: "gallery", name: `G${i}`, pictures: [pic("a"), pic("b"), pic("c")] }))),
      facts,
      "",
    );
    expect(many.plan.sections.flatMap((s) => s.pictures ?? [])).toHaveLength(8);
    expect(many.plan.sections).toHaveLength(3);
  });

  it("tints only where the theme has one colour scheme", () => {
    const planned = plan([{ pattern: "callToAction", name: "Kontakt", tinted: true }]);
    expect(checkPlan(planned, facts, "").plan.sections[0].tinted).toBe(true);
    expect(checkPlan(planned, { ...facts, tint: null }, "").plan.sections[0].tinted).toBeUndefined();
  });

  it("tells the model the designs, the addresses to use and, to change a plan, the plan and the change", () => {
    const current = plan([{ pattern: "hero", name: "Åpning" }]);
    const [system, user] = planMessages(facts, { ...EMPTY_BRIEF, pictures: "lyse, naturlige foto" }, "Vi brenner hver tirsdag", { plan: current, request: "Legg til spørsmål og svar" });
    expect(system.content).toContain('"faq"');
    expect(system.content).toContain("- /s/kaffe/no/om-oss (Page: Om oss)");
    expect(system.content).toContain("lyse, naturlige foto");
    expect(system.content).not.toContain('"articles"');
    expect(user.content).toContain("Vi brenner hver tirsdag");
    expect(user.content).toContain("Legg til spørsmål og svar");
  });
});

describe("a section's words", () => {
  it("are read from the model's answer, with what it cannot be left empty", () => {
    expect(readCopy('{"heading": "Hei", "items": [{"title": "A", "text": "B", "icon": "unicorn"}], "buttons": "none"}')).toEqual({
      heading: "Hei",
      text: "",
      items: [{ title: "A", text: "B", icon: undefined }],
      buttons: [],
      captions: [],
    });
    expect(readCopy("Sorry")).toBeNull();
  });

  it("are checked by the claims filter, and a claim still there after asking again goes with its sentence", () => {
    const words = copy({
      heading: "Bærekraftig kaffe",
      text: "Vi brenner i Bergen. Kun i dag: 20 % rabatt! Kaffen er ferskbrent.",
      items: [{ title: "Beste pris", text: "Alltid." }],
    });
    expect(copyClaims(words).map((claim) => [claim.kind, claim.where])).toEqual([
      ["green", "heading"],
      ["urgency", "text"],
      ["bestPrice", "item 1"],
    ]);
    expect(withoutClaims(words.text)).toBe("Vi brenner i Bergen. Kaffen er ferskbrent.");
    expect(copyClaims(copyWithoutClaims(words))).toEqual([]);
    const [, user] = copyMessages(facts, EMPTY_BRIEF, plan([{ pattern: "hero", name: "Åpning" }]), 0, "", { claims: ['"kun i dag" (urgency)'] });
    expect(user.content).toContain('"kun i dag" (urgency)');
    expect(user.content).toContain("main heading");
  });
});

describe("building the page", () => {
  const every = plan([
    { pattern: "hero", variant: "split-right", name: "Åpning", picture: pic("a coffee roaster"), links: ["/s/kaffe/no/products", "/s/kaffe/no/om-oss"] },
    { pattern: "features", name: "Hvorfor oss", tinted: true },
    { pattern: "checklist", name: "Slik funker det", picture: pic("a cup") },
    { pattern: "textImage", variant: "left", name: "Brenneriet", picture: pic("the roastery") },
    { pattern: "text", name: "Historien" },
    { pattern: "steps", name: "Bestilling" },
    { pattern: "faq", name: "Spørsmål" },
    { pattern: "tabs", name: "Detaljer" },
    { pattern: "products", name: "Utvalg", category: "espresso", display: "carousel", limit: 6 },
    { pattern: "gallery", name: "Bilder", pictures: [pic("beans"), pic("cups")] },
    { pattern: "callToAction", name: "Kontakt", links: ["mailto:post@kaffe.no"] },
  ]);
  const words: SectionCopy[] = [
    copy({ heading: "Kaffe fra Bergen", text: "Brent hver uke.", buttons: [{ label: "Se kaffen", href: "/s/kaffe/no/products" }, { label: "Om oss", href: "/s/kaffe/no/om-oss" }] }),
    copy({ heading: "Hvorfor oss", items: [{ title: "Fersk", text: "Brent hver uke." }, { title: "Lokal", text: "Fra Bergen." }, { title: "Enkel", text: "Rett hjem." }] }),
    copy({ heading: "Slik funker det", items: [{ title: "", text: "Velg kaffe", icon: "coffee" }, { title: "", text: "Vi sender", icon: "truck" }] }),
    copy({ heading: "Brenneriet", text: "Vi brenner i **små** partier.\n\nSe [sortimentet](/s/kaffe/no/products) eller [her](https://evil.example)." }),
    copy({ heading: "Historien", text: "Det begynte i 2015." }),
    copy({ heading: "Bestilling", items: [{ title: "Velg", text: "a" }, { title: "Betal", text: "b" }, { title: "Nyt", text: "c" }] }),
    copy({ heading: "Spørsmål", items: [{ title: "Hvor ofte brenner dere?", text: "Hver uke." }] }),
    copy({ items: [{ title: "Kverning", text: "Hel eller malt." }, { title: "Lagring", text: "Tørt og mørkt." }] }),
    copy({ heading: "Utvalget", buttons: [{ label: "Alt", href: "/s/kaffe/no/products" }] }),
    copy({ heading: "Bilder", captions: ["Bønner", ""] }),
    copy({ heading: "Snakk med oss", text: "Vi svarer raskt.", buttons: [{ label: "Send e-post", href: "https://phish.example" }] }),
  ];
  const built = buildPage(every, words, facts, { newId, takenSlugs: ["var-kaffe"], reservedSlugs: RESERVED_STORE_PAGE_SLUGS });

  it("is a page the builder could make: it passes the page's own check", () => {
    expect(pageInput.safeParse(built.content).success).toBe(true);
    expect(built.content).toMatchObject({ title: "Vår kaffe", slug: "var-kaffe-2", seo: { description: "Kaffe fra Bergen." } });
  });

  it("has one main heading, and the builder's own components for each design", () => {
    const blocks = pageBlocks(built.content);
    expect(blocks.filter((b): b is Extract<PageBlock, { type: "heading" }> => b.type === "heading" && b.level === 1).map((b) => b.text)).toEqual(["Kaffe fra Bergen"]);
    const kinds = new Set(blocks.map((b) => b.type));
    for (const kind of ["heading", "richText", "image", "dualButton", "iconList", "faq", "tabs", "contentGrid", "button"]) expect(kinds.has(kind as PageBlock["type"])).toBe(true);
    const grid = blocks.find((b) => b.type === "contentGrid");
    expect(grid).toMatchObject({ source: { type: "products" }, categories: [facts.productCategories[0].id], limit: 6, display: "carousel" });
  });

  it("links only to the site's own addresses, falling back to the plan's", () => {
    const blocks = pageBlocks(built.content);
    const json = JSON.stringify(blocks);
    expect(json).not.toContain("evil.example");
    expect(json).not.toContain("phish.example");
    // The model's own address was not the site's: the plan's is used.
    expect(blocks.filter((b) => b.type === "button").map((b) => (b as { href: string }).href)).toContain("mailto:post@kaffe.no");
  });

  it("leaves the pictures empty, with a job for each; the opening's is the page's own", () => {
    expect(built.pictures).toHaveLength(5);
    expect(built.pictures.filter((job) => job.thumbnail)).toHaveLength(1);
    expect(built.pictures[0]).toMatchObject({ thumbnail: true, shape: "landscape", alt: "Bilde av a coffee roaster" });
    const images = pageBlocks(built.content).filter((b) => b.type === "image");
    expect(images.every((b) => !blockHasContent(b))).toBe(true);
    expect(built.pictures.map((job) => job.target)).toEqual(images.map((b) => ({ kind: "block", blockId: b.id })));
  });

  it("tints the rows of a tinted section with the theme's colour", () => {
    const tinted = built.content.rows.filter((r) => r.background?.type === "color");
    expect(tinted.length).toBeGreaterThanOrEqual(2);
    expect(tinted.every((r) => r.background?.type === "color" && r.background.color === "#f4f1ec")).toBe(true);
  });

  it("draws a banner opening's picture behind it, with white words", () => {
    const banner = buildPage(
      plan([{ pattern: "hero", variant: "banner", name: "Åpning", picture: pic("a cafe"), links: ["/s/kaffe/no/products"] }]),
      [copy({ heading: "Kaffe", text: "Fra Bergen.", buttons: [{ label: "Kjøp", href: "/s/kaffe/no/products" }] })],
      facts,
      { newId, takenSlugs: [], reservedSlugs: RESERVED_STORE_PAGE_SLUGS },
    );
    expect(banner.pictures).toEqual([expect.objectContaining({ target: { kind: "row", rowId: banner.content.rows[0].id }, thumbnail: true })]);
    expect(banner.content.rows[0]).toMatchObject({ width: "full" });
    expect(pageBlocks(banner.content)[0]).toMatchObject({ type: "heading", level: 1, textColor: "#ffffff" });
    expect(pageInput.safeParse(banner.content).success).toBe(true);
  });

  it("gives the picture model the plan's description, the owner's style, and no words in the picture", () => {
    expect(picturePrompt(pic("beans"), { ...EMPTY_BRIEF, pictures: "warm, analog film look" })).toBe(
      "A photo of beans, soft daylight, realistic. Style: warm, analog film look. No text, letters, numbers, logos or watermarks anywhere in the picture.",
    );
  });
});

describe("every design, with any number of items", () => {
  const everywhere = { ...facts, can: { pictures: true, productGrid: true, articleGrid: true, googleReviews: true } };
  const variants = (key: string) => {
    const info = PATTERNS[key as keyof typeof PATTERNS] as { variants?: Record<string, string> };
    return info.variants ? Object.keys(info.variants) : [undefined];
  };

  it("builds rows the page's own check takes: each with as many columns as its layout", () => {
    for (const key of Object.keys(PATTERNS)) {
      for (const variant of variants(key)) {
        for (let count = 0; count <= 12; count++) {
          for (const tinted of [false, true]) {
            const pictures = key === "gallery" ? Array.from({ length: Math.min(4, Math.max(2, count)) }, (_, i) => pic(`shot ${i}`)) : undefined;
            const planned = plan([
              { pattern: key, variant, name: "S", tinted, picture: pic("a thing"), pictures, video: "https://youtu.be/dQw4w9WgXcQ", links: ["/s/kaffe/no/products"] },
            ]);
            const { plan: checked } = checkPlan(planned, everywhere, "https://youtu.be/dQw4w9WgXcQ");
            const words = copy({
              heading: "Overskrift",
              text: "Tekst.",
              items: Array.from({ length: count }, (_, i) => ({ title: `Punkt ${i + 1}`, text: "Tekst.", icon: "check" as const })),
              buttons: [{ label: "Se", href: "/s/kaffe/no/products" }],
              captions: ["A", "B"],
            });
            const built = buildPage(checked, [words], everywhere, { newId, takenSlugs: [], reservedSlugs: RESERVED_STORE_PAGE_SLUGS });
            const result = pageInput.safeParse(built.content);
            const where = `${key} ${variant ?? ""} with ${count} items${tinted ? ", tinted" : ""}`;
            expect(result.success ? "" : `${where}: ${result.error.issues.map((i) => i.message).join("; ")}`).toBe("");
            for (const r of built.content.rows) expect(r.columns.length, where).toBe(ROW_LAYOUTS[r.layout].widths.length);
          }
        }
      }
    }
  });

  it("keeps five features in columns of equal width: three, then two and an empty one", () => {
    const built = buildPage(
      plan([{ pattern: "features", name: "Hvorfor oss" }]),
      [copy({ heading: "Hvorfor", items: Array.from({ length: 5 }, (_, i) => ({ title: `P${i}`, text: "T" })) })],
      facts,
      { newId, takenSlugs: [], reservedSlugs: RESERVED_STORE_PAGE_SLUGS },
    );
    const [, first, second] = built.content.rows;
    expect([first.layout, first.columns.map((c) => c.blocks.length)]).toEqual(["3", [2, 2, 2]]);
    expect([second.layout, second.columns.map((c) => c.blocks.length)]).toEqual(["3", [2, 2, 0]]);
  });
});

describe("addresses and availability", () => {
  it("finds a free address among the owner's pages and the store's own routes", () => {
    expect(uniqueSlug("Om oss & priser", [], RESERVED_STORE_PAGE_SLUGS)).toBe("om-oss-priser");
    expect(uniqueSlug("om-oss", ["om-oss", "om-oss-2"], [])).toBe("om-oss-3");
    expect(uniqueSlug("cart", [], RESERVED_STORE_PAGE_SLUGS)).toBe("cart-page");
    expect(uniqueSlug("!!!", [], [])).toBe("page");
  });

  it("offers product grids, articles and Google reviews only where the site has them", () => {
    expect(availablePatterns(facts)).toContain("products");
    expect(availablePatterns(facts)).not.toContain("reviews");
    expect(availablePatterns({ ...facts, can: { pictures: false, productGrid: false, articleGrid: true, googleReviews: true } })).toEqual(
      expect.arrayContaining(["articles", "reviews"]),
    );
    expect(availablePatterns({ ...facts, can: { ...facts.can, pictures: false } })).not.toContain("gallery");
  });

  it("uses the claims filter as the rest of the site does", () => {
    expect(findClaims("Miljøvennlig kaffe").length).toBeGreaterThan(0);
  });
});

describe("pictures built by the studio carry no size of their own (D151)", () => {
  const everywhere = { ...facts, can: { pictures: true, productGrid: true, articleGrid: true, googleReviews: true } };
  const variants = (key: string) => {
    const info = PATTERNS[key as keyof typeof PATTERNS] as { variants?: Record<string, string> };
    return info.variants ? Object.keys(info.variants) : [undefined];
  };
  const imagesOf = (content: Parameters<typeof pageBlocks>[0]) => pageBlocks(content).filter((b) => b.type === "image");

  it("leaves a picture's width and position unset in every design, so it is drawn at its own size and at the left until the owner says otherwise", () => {
    let seen = 0;
    const designs = new Set<string>();
    for (const key of Object.keys(PATTERNS)) {
      for (const variant of variants(key)) {
        const pictures = key === "gallery" ? [pic("beans"), pic("cups"), pic("a roaster")] : undefined;
        const planned = plan([{ pattern: key, variant, name: "S", picture: pic("a thing"), pictures, video: "https://youtu.be/dQw4w9WgXcQ", links: ["/s/kaffe/no/products"] }]);
        const { plan: checked } = checkPlan(planned, everywhere, "https://youtu.be/dQw4w9WgXcQ");
        const words = copy({
          heading: "Overskrift",
          text: "Tekst.",
          items: [{ title: "Punkt 1", text: "Tekst.", icon: "check" as const }, { title: "Punkt 2", text: "Tekst.", icon: "check" as const }],
          buttons: [{ label: "Se", href: "/s/kaffe/no/products" }],
          captions: ["A", "B", "C"],
        });
        const built = buildPage(checked, [words], everywhere, { newId, takenSlugs: [], reservedSlugs: RESERVED_STORE_PAGE_SLUGS });
        const where = `${key} ${variant ?? ""}`;
        const images = imagesOf(built.content);
        for (const image of images) {
          expect(image, where).not.toHaveProperty("maxWidth");
          expect(image, where).not.toHaveProperty("align");
          seen += 1;
          designs.add(key);
        }
        // Saved as the builder saves it, the page still has none: the schema adds no default.
        const saved = pageInput.parse(built.content);
        for (const image of imagesOf(saved)) {
          expect(image, where).not.toHaveProperty("maxWidth");
          expect(image, where).not.toHaveProperty("align");
        }
        expect(imagesOf(saved), where).toHaveLength(images.length);
      }
    }
    // The check looked at pictures: the designs with a picture and the gallery made some.
    expect(seen).toBeGreaterThan(5);
    expect(designs.has("hero")).toBe(true);
    expect(designs.has("gallery")).toBe(true);
    expect(designs.has("textImage")).toBe(true);
  });
});

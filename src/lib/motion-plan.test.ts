import { describe, expect, it } from "vitest";

import { backgroundMotionSchema, partMotionSchema, type EnterMotion } from "./motion";
import {
  CAPS,
  OUTLINE_MAX_CHARACTERS,
  STYLES,
  applyMotionPlan,
  cleanMotionPlan,
  enterFamily,
  motionPlanRefusal,
  outlinePage,
  redact,
  ruleBasedPlan,
  type MotionPlan,
  type MotionPlanItem,
} from "./motion-plan";
import { pageRowSchema, type BlockType, type PageBlock, type PageColumn, type PageRow } from "./page-content";
import { newBlock } from "./page-rows";
import { ENTER_EFFECTS } from "./motion";

/** Pages built for the tests: ids count up, so a part can be found by name. */
let n = 0;
const nextId = () => `p${++n}`;
const doc = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const block = (type: BlockType, extra: Record<string, unknown> = {}): PageBlock =>
  ({ ...newBlock(type, nextId), ...extra }) as PageBlock;
const heading = (text: string, extra: Record<string, unknown> = {}) => block("heading", { text, ...extra });
const prose = (text: string) => block("richText", { doc: doc(text) });
const button = (label = "Buy", extra: Record<string, unknown> = {}) =>
  block("button", { label, href: "https://shop.example/buy", ...extra });
const image = (extra: Record<string, unknown> = {}) =>
  block("image", { image: { url: "https://cdn.example/a.webp", width: 800, height: 600, alt: "A picture" }, ...extra });

const col = (blocks: PageBlock[], extra: Partial<PageColumn> = {}): PageColumn => ({ id: nextId(), blocks, ...extra });
const row = (columns: PageColumn[], extra: Partial<PageRow> = {}): PageRow => ({
  id: nextId(),
  type: "row",
  layout: String(columns.length) as PageRow["layout"],
  columns,
  ...extra,
});
const one = (...blocks: PageBlock[]) => row([col(blocks)]);
const picture = {
  type: "image" as const,
  image: { url: "https://cdn.example/bg.webp", width: 1600, height: 900, alt: "" },
  overlay: null,
};
const modal = (...blocks: PageBlock[]): PageRow =>
  row([col(blocks)], { modal: { key: "m1", name: "Offer", triggers: { button: true }, frequency: "always" } as never });

const byId = (plan: MotionPlan | null, id: string): MotionPlanItem | undefined =>
  plan?.items.find((item) => item.id === id);
const enter = (effect: string, extra: Record<string, unknown> = {}) => ({ effect, ...extra });

/** A page like an owner's: a hero, a two column story with a picture, three cards, and a call to action over a picture. */
function samplePage() {
  const h1 = heading("Handmade ceramics from Bergen", { level: 1 });
  const lead = prose("Cups, bowls and plates thrown by hand.");
  const cta = button("Shop now");
  const hero = row([col([h1, lead, cta])], { background: picture });
  const photo = image();
  const story = row([col([photo]), col([heading("Our story"), prose("Three generations of potters.")])]);
  const cards = row(
    [1, 2, 3].map((i) =>
      col([heading(`Card ${i}`), prose("Text"), button("More")], {
        border: { width: { top: 1, right: 1, bottom: 1, left: 1 }, color: "#cccccc", style: "solid" as const },
      }),
    ),
  );
  const banner = row([col([heading("Join us"), button("Sign up")])], { background: picture });
  const divider = one(block("separator"));
  return { rows: [hero, story, cards, divider, banner], h1, lead, cta, hero, photo, story, cards, banner, divider };
}

// ---------------------------------------------------------------------------

describe("outlinePage", () => {
  it("lists the flow's rows in order with their columns and blocks, the first flow row marked, modals left out", () => {
    const page = samplePage();
    const popup = modal(heading("Newsletter"));
    const outline = outlinePage([popup, ...page.rows]);
    expect(outline.rows.map((r) => r.id)).toEqual(page.rows.map((r) => r.id));
    expect(outline.rows[0]).toMatchObject({ id: page.hero.id, kind: "row", firstRow: true, layout: "1", bg: "image" });
    expect(outline.rows.slice(1).some((r) => r.firstRow)).toBe(false);
    expect(JSON.stringify(outline)).not.toContain(popup.id);
    const second = outline.rows[1].columns!;
    expect(second.map((c) => c.id)).toEqual(page.story.columns.map((c) => c.id));
    expect(second[0].blocks[0]).toMatchObject({ id: page.photo.id, type: "image" });
  });

  it("says what already has motion, and what background a part has", () => {
    const moving = row(
      [
        col([heading("A", { motion: { hover: { effect: "lift" } } })], {
          backgroundMotion: { effect: "parallax" },
          background: picture,
        }),
      ],
      {
        motion: { enter: { effect: "fade" } },
        backgroundMotion: { effect: "ken-burns" },
      },
    );
    const [out] = outlinePage([moving]).rows;
    expect(out).toMatchObject({ motion: true, bgMotion: true });
    expect(out.columns![0]).toMatchObject({ bgMotion: true, bg: "image" });
    expect(out.columns![0].blocks[0].motion).toBe(true);
  });

  it("gives headlines a short snippet and never addresses, emails, phone numbers or prices", () => {
    const outline = outlinePage([
      one(
        heading("Write to hello@shop.example or see https://shop.example/x now"),
        prose("Call +47 900 00 000 today: 199 kr, 25 EUR or €30 off. " + "long ".repeat(60)),
        button("Secret label", { href: "https://private.example/token" }),
        block("emailForm", { recipients: ["owner@shop.example"] }),
        block("testimonials", {
          items: [{ id: "t", quote: "Best ever", name: "Jane Customer", role: "", picture: null }],
        }),
      ),
    ]);
    const text = JSON.stringify(outline);
    for (const bad of [
      "hello@",
      "shop.example",
      "+47",
      "900",
      "199",
      "kr",
      "EUR",
      "€",
      "private.example",
      "Secret label",
      "owner@",
      "Jane",
      "Best ever",
    ])
      expect(text).not.toContain(bad);
    const blocks = outline.rows[0].columns![0].blocks;
    expect(blocks.map((b) => b.type)).toEqual(["heading", "richText", "button", "emailForm", "testimonials"]);
    for (const b of blocks) expect((b.text ?? "").length).toBeLessThanOrEqual(80);
    expect(blocks[0].text).toContain("Write to");
  });

  it("stays within its size, dropping detail before it drops a row", () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      row(
        [1, 2, 3].map(() =>
          col([
            heading(`Heading number ${i} with a fair amount of words in it`),
            prose("word ".repeat(100)),
            button(),
            image(),
            prose("more"),
          ]),
        ),
      ),
    );
    for (const r of rows) {
      r.id = crypto.randomUUID();
      for (const c of r.columns) {
        c.id = crypto.randomUUID();
        for (const b of c.blocks) b.id = crypto.randomUUID();
      }
    }
    const outline = outlinePage(rows);
    expect(JSON.stringify(outline).length).toBeLessThanOrEqual(OUTLINE_MAX_CHARACTERS);
    // What fits keeps its ids, in order, and a cut is said.
    expect(outline.rows.map((r) => r.id)).toEqual(rows.slice(0, outline.rows.length).map((r) => r.id));
    expect(outline.rows.length + (outline.truncated ?? 0)).toBe(rows.length);
  });

  it("keeps every row's id when only detail has to go", () => {
    const rows = Array.from({ length: 12 }, () =>
      row([
        col([heading("A heading of some length here", { level: 1 }), prose("Prose ".repeat(50)), button(), image()]),
      ]),
    );
    const outline = outlinePage(rows);
    expect(outline.truncated).toBeUndefined();
    expect(outline.rows).toHaveLength(12);
    expect(JSON.stringify(outline).length).toBeLessThanOrEqual(OUTLINE_MAX_CHARACTERS);
  });
});

describe("redact", () => {
  it("takes out what is not a designer's business", () => {
    expect(redact("Email me@x.no  or visit www.x.no now")).toBe("Email or visit now");
    expect(redact("Only 99,50 kr today")).toBe("Only today");
    expect(redact("Pay $ 20 and £5")).not.toMatch(/\d/);
  });
});

// ---------------------------------------------------------------------------

describe("cleanMotionPlan", () => {
  it("returns null for what is not a plan, or has nothing usable", () => {
    const { rows } = samplePage();
    expect(cleanMotionPlan(null, rows)).toBeNull();
    expect(cleanMotionPlan("fade", rows)).toBeNull();
    expect(cleanMotionPlan({ style: "subtle" }, rows)).toBeNull();
    expect(cleanMotionPlan({ style: "subtle", items: [] }, rows)).toBeNull();
    expect(cleanMotionPlan({ items: [{ id: "nope", enter: enter("fade") }] }, rows)).toBeNull();
    expect(cleanMotionPlan({ items: [{ id: rows[1].id, enter: enter("shazam") }] }, rows)).toBeNull();
    expect(
      cleanMotionPlan({ items: [{ id: rows[1].id, enter: enter("constructor") }, { id: "__proto__" }] }, rows),
    ).toBeNull();
  });

  it("keeps only ids that exist and effects in the catalogues", () => {
    const { rows, story, banner } = samplePage();
    const plan = cleanMotionPlan(
      {
        style: "elegant",
        items: [
          { id: story.id, enter: enter("fade-up") },
          { id: "ghost", enter: enter("fade-up") },
          { id: banner.id, enter: enter("not-an-effect"), hover: { effect: "lift" } },
        ],
      },
      rows,
    );
    expect(plan?.items.map((i) => i.id)).toEqual([story.id]);
    expect(plan?.aiUsed).toBe(true);
  });

  it("strips unknown keys and every value the schemas would refuse", () => {
    const { rows, story } = samplePage();
    const plan = cleanMotionPlan(
      {
        style: "elegant",
        items: [
          {
            id: story.id,
            evil: "x",
            enter: { effect: "fade-up", delay: "soon", stagger: null, script: "alert(1)", speed: "warp" },
          },
        ],
      },
      rows,
    );
    const item = plan!.items[0];
    expect(Object.keys(item).sort()).toEqual(["enter", "id"]);
    expect(Object.keys(item.enter!)).not.toContain("script");
    expect(partMotionSchema.safeParse({ enter: item.enter }).success).toBe(true);
    expect(item.enter!.speed).toBe(STYLES.elegant.speed);
  });

  it("snaps delays to steps of 50 within 0 to 2000, and staggers to 400 where columns or words can take one", () => {
    const { rows, cards, story, photo, banner } = samplePage();
    const plan = cleanMotionPlan(
      {
        style: "elegant",
        items: [
          { id: story.id, enter: enter("fade-up", { delay: 5000, stagger: 9999 }) },
          { id: cards.id, enter: enter("fade-up", { delay: 333, stagger: 250 }) },
          { id: banner.columns[0].blocks[0].id, enter: enter("fade-up", { delay: -20, stagger: 200 }) },
        ],
      },
      rows,
    );
    expect(photo).toBeDefined();
    expect(byId(plan, story.id)!.enter).toMatchObject({ delay: 2000, stagger: 400 });
    expect(byId(plan, cards.id)!.enter).toMatchObject({ delay: 350, stagger: 250 });
    // A picture has nothing to stagger.
    const heading = byId(plan, banner.columns[0].blocks[0].id)!.enter!;
    expect(heading).not.toHaveProperty("stagger");
    expect(heading).not.toHaveProperty("delay");
  });

  it("puts text effects on headings and text only", () => {
    const h = heading("Our story");
    const p = prose("Some words");
    const pic = image();
    const btn = button();
    const sec = row([col([h, p, pic, btn])]);
    const rows = [one(heading("Hero", { level: 1 })), sec];
    const plan = cleanMotionPlan(
      {
        style: "elegant",
        items: [
          { id: h.id, enter: enter("words") },
          { id: p.id, enter: enter("lines") },
          { id: pic.id, enter: enter("words") },
          { id: btn.id, enter: enter("chars") },
          { id: sec.id, enter: enter("words") },
        ],
      },
      rows,
    );
    // The row and its parts: the row's own text effect is refused, so its blocks may go on their own.
    expect(byId(plan, sec.id)).toBeUndefined();
    expect(byId(plan, pic.id)).toBeUndefined();
    expect(byId(plan, btn.id)).toBeUndefined();
    expect(byId(plan, h.id)!.enter!.effect).toBe("words");
    expect(byId(plan, p.id)!.enter!.effect).toBe("lines");
  });

  it("drops effects from components that should stay still, and from modals", () => {
    const still = (
      ["separator", "html", "storePart", "product", "site", "menu", "search", "customField", "fieldLoop"] as const
    ).map((t) => block(t));
    const popup = modal(heading("Hi"), button());
    const rows = [one(heading("Hero", { level: 1 })), row([col(still)]), popup];
    const wanted = [
      ...still.map((b) => b.id),
      popup.id,
      popup.columns[0].id,
      ...popup.columns[0].blocks.map((b) => b.id),
    ];
    const plan = cleanMotionPlan(
      {
        items: wanted.map((id) => ({
          id,
          enter: enter("fade-up"),
          hover: { effect: "lift" },
          scroll: { effect: "parallax" },
          backgroundMotion: { effect: "parallax" },
        })),
      },
      rows,
    );
    expect(plan).toBeNull();
  });

  it("allows an entrance on each of the components that suit one", () => {
    const types: BlockType[] = [
      "richText",
      "heading",
      "image",
      "button",
      "dualButton",
      "video",
      "contentGrid",
      "accordion",
      "tabs",
      "faq",
      "testimonials",
      "iconList",
      "socialLinks",
      "emailForm",
      "newsletter",
    ];
    const blocks = types.map((t) => block(t));
    // Spread over enough rows that the one-in-three budget is not what is being tested.
    const rows = [one(heading("Hero", { level: 1 })), ...blocks.map((b) => one(b))];
    const plan = cleanMotionPlan({ items: blocks.map((b) => ({ id: b.id, enter: enter("fade-up") })) }, rows);
    expect(plan!.items.map((i) => i.id)).toEqual(blocks.map((b) => b.id).slice(0, plan!.items.length));
    expect(plan!.items.length).toBeGreaterThan(3);
  });

  it("keeps a page from becoming a circus: about one part in three, and the hard caps", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row(
        [
          col([heading(`H${i}`), prose("x"), button(), image()], { background: i % 2 ? picture : undefined }),
          col([button()]),
        ],
        { background: picture },
      ),
    );
    const everything = rows.flatMap((r) => [r.id, ...r.columns.flatMap((c) => [c.id, ...c.blocks.map((b) => b.id)])]);
    const plan = cleanMotionPlan(
      {
        style: "lively",
        items: everything.map((id) => ({
          id,
          enter: enter("fade-up"),
          hover: { effect: "lift" },
          scroll: { effect: "parallax" },
          backgroundMotion: { effect: "parallax" },
        })),
      },
      rows,
    );
    const items = plan!.items;
    const parts = 30 + 60 + 30 * 5; // rows, columns, components that take an entrance
    expect(items.filter((i) => i.enter).length).toBeLessThanOrEqual(Math.min(CAPS.entrances, Math.ceil(parts / 3)));
    expect(items.filter((i) => i.hover).length).toBeLessThanOrEqual(CAPS.hovers);
    expect(items.filter((i) => i.scroll).length).toBeLessThanOrEqual(CAPS.scrolls);
    expect(items.filter((i) => i.backgroundMotion).length).toBeLessThanOrEqual(CAPS.backgrounds);
  });

  it("counts the owner's own entrances against the budget", () => {
    const blocks = Array.from({ length: 6 }, () => heading("x"));
    const rows = blocks.map((b) => one(b));
    rows[0].motion = { enter: { effect: "fade" } };
    rows[1].motion = { enter: { effect: "fade" } };
    rows[2].motion = { enter: { effect: "fade" } };
    const plan = cleanMotionPlan({ items: rows.map((r) => ({ id: r.id, enter: enter("fade-up") })) }, rows);
    // 6 rows, 6 columns, 6 headings: budget 6, three used already.
    expect(plan!.items.filter((i) => i.enter).length).toBeLessThanOrEqual(3);
    for (const owned of rows.slice(0, 3)) expect(byId(plan, owned.id)).toBeUndefined();
  });

  it("makes the first flow row load with the page, with short delays, and keeps its text still on scroll", () => {
    const h = heading("Welcome", { level: 1 });
    const p = prose("Intro");
    const pic = image();
    const hero = row([col([h, p, pic])]);
    const later = one(heading("Later"));
    const plan = cleanMotionPlan(
      {
        style: "elegant",
        items: [
          { id: h.id, enter: enter("fade-up", { delay: 1800, trigger: "view" }) },
          { id: p.id, scroll: { effect: "fade-scroll" } },
          { id: pic.id, enter: enter("wipe-up", { delay: 1000 }) },
          { id: later.columns[0].blocks[0].id, scroll: { effect: "fade-scroll" } },
        ],
      },
      [modal(heading("Popup")), hero, later],
    );
    expect(byId(plan, h.id)!.enter).toMatchObject({ trigger: "load", delay: CAPS.firstRowDelay });
    expect(byId(plan, h.id)!.enter).not.toHaveProperty("start");
    // The first row's text does not move with the scroll; text further down may fade with it.
    expect(byId(plan, p.id)).toBeUndefined();
    expect(byId(plan, later.columns[0].blocks[0].id)!.scroll!.effect).toBe("fade-scroll");
    // A picture at the top is never hidden by a wipe.
    const shown = byId(plan, pic.id)!.enter!;
    expect(["wipe-left", "wipe-up", "iris"]).not.toContain(shown.effect);
    expect(shown.trigger).toBe("load");
  });

  it("makes every entrance play once and follow the chosen style", () => {
    const { rows, story, cards, banner } = samplePage();
    const raw = {
      items: [story, cards, banner].map((r) => ({
        id: r.id,
        enter: enter("iris", { speed: "slow", ease: "bounce", distance: "large", once: false }),
      })),
    };
    for (const style of ["subtle", "elegant", "lively"] as const) {
      const plan = cleanMotionPlan({ ...raw, style }, rows)!;
      expect(plan.style).toBe(style);
      for (const item of plan.items) {
        const e = item.enter as EnterMotion;
        expect(e.once).toBe(true);
        expect(STYLES[style].enter).toContain(e.effect);
        expect(e.speed).toBe(STYLES[style].speed);
        expect(e.ease).toBe(STYLES[style].ease);
        expect(e.distance).toBe(STYLES[style].distance);
      }
    }
    expect(cleanMotionPlan({ ...raw, style: "wild" }, rows)!.style).toBe("elegant");
  });

  it("uses at most two families of entrance across the page", () => {
    const sections = Array.from({ length: 8 }, () => one(heading("x"), button()));
    const rows = [one(heading("Hero", { level: 1 })), ...sections];
    const effects = ["fade-up", "fade-up", "fade-up", "fade", "blur-in", "wipe-up", "wipe-left", "blur-up"] as const;
    const plan = cleanMotionPlan(
      { style: "elegant", items: sections.map((r, i) => ({ id: r.id, enter: enter(effects[i]) })) },
      rows,
    )!;
    const families = new Set(plan.items.map((i) => enterFamily(i.enter!.effect)));
    expect(families.size).toBeLessThanOrEqual(2);
    expect(families.has("fade")).toBe(true);
  });

  it("lets columns come in turn with one stagger on the row, not a delay each", () => {
    const { rows, cards } = samplePage();
    const plan = cleanMotionPlan(
      {
        style: "elegant",
        items: cards.columns.map((c, i) => ({ id: c.id, enter: enter("fade-up", { delay: i * 300 }) })),
      },
      rows,
    )!;
    expect(plan.items.map((i) => i.id)).toEqual([cards.id]);
    expect(plan.items[0].enter!.stagger).toBeGreaterThan(0);
    expect(plan.items[0].enter).not.toHaveProperty("delay");
    // A row's own entrance over several columns gets a stagger too.
    const own = cleanMotionPlan({ items: [{ id: cards.id, enter: enter("fade-up") }] }, rows)!;
    expect(own.items[0].enter!.stagger).toBe(100);
  });

  it("allows two columns to come in from opposite sides", () => {
    const { rows, story } = samplePage();
    const plan = cleanMotionPlan(
      {
        style: "lively",
        items: [
          { id: story.columns[0].id, enter: enter("fade-right") },
          { id: story.columns[1].id, enter: enter("fade-left", { delay: 100 }) },
        ],
      },
      rows,
    )!;
    expect(plan.items.map((i) => i.enter!.effect)).toEqual(["fade-right", "fade-left"]);
  });

  it("puts no entrance inside another entrance", () => {
    const { rows, story, cards } = samplePage();
    const inner = cards.columns[0].blocks[0].id;
    const storyBlock = story.columns[1].blocks[0].id;
    const plan = cleanMotionPlan(
      {
        items: [
          { id: cards.id, enter: enter("fade-up") },
          { id: inner, enter: enter("fade-up") },
          { id: story.columns[1].id, enter: enter("fade-up") },
          { id: storyBlock, enter: enter("fade-up") },
        ],
      },
      rows,
    )!;
    expect(byId(plan, cards.id)).toBeDefined();
    expect(byId(plan, inner)).toBeUndefined();
    expect(byId(plan, storyBlock)).toBeUndefined();
  });

  it("gives buttons and cards a hover that suits them, and nothing else", () => {
    const { rows, cta, cards, banner, story } = samplePage();
    const plan = cleanMotionPlan(
      {
        style: "elegant",
        items: [
          { id: cta.id, hover: { effect: "magnetic" } },
          { id: cards.columns[0].id, hover: { effect: "lift" } },
          { id: cards.columns[0].blocks[0].id, hover: { effect: "lift" } },
          { id: banner.id, hover: { effect: "lift" } },
          { id: story.columns[0].id, hover: { effect: "lift" } },
          { id: cards.columns[1].id, hover: { effect: "nonsense" } },
        ],
      },
      rows,
    )!;
    expect(byId(plan, cta.id)!.hover).toEqual({ effect: "magnetic", intensity: "subtle" });
    expect(byId(plan, cards.columns[0].id)!.hover!.effect).toBe("lift");
    expect(byId(plan, cards.columns[0].blocks[0].id)).toBeUndefined(); // a heading
    expect(byId(plan, banner.id)).toBeUndefined(); // a row
    expect(byId(plan, cards.columns[1].id)).toBeUndefined();
  });

  it("gives a picture behind a section parallax or a slow zoom, and colours and gradients nothing", () => {
    const withColor = one(heading("a"));
    withColor.background = { type: "color", color: "#f5f5f5", opacity: 1 } as never;
    const withGradient = one(heading("b"));
    withGradient.background = {
      type: "gradient",
      style: "aurora",
      colors: ["#ff0000", "#0000ff"],
    } as never;
    const withVideo = one(heading("c"));
    withVideo.background = { type: "video", video: { url: "https://cdn.example/v.mp4" } } as never;
    const withPicture = row([col([heading("d")], { background: picture })], { background: picture });
    const rows = [one(heading("Hero", { level: 1 })), withColor, withGradient, withVideo, withPicture];
    const plan = cleanMotionPlan(
      {
        style: "elegant",
        items: [withColor, withGradient, withVideo, withPicture, withPicture.columns[0]].map((r) => ({
          id: r.id,
          backgroundMotion: { effect: "ken-burns" },
        })),
      },
      rows,
    )!;
    expect(byId(plan, withColor.id)).toBeUndefined();
    expect(byId(plan, withGradient.id)).toBeUndefined();
    expect(byId(plan, withVideo.id)!.backgroundMotion!.effect).toBe("parallax"); // a video does not need a slow zoom
    expect(byId(plan, withPicture.id)!.backgroundMotion!.effect).toBe("ken-burns");
    expect(byId(plan, withPicture.columns[0].id)!.backgroundMotion).toBeDefined();
    for (const item of plan.items) expect(backgroundMotionSchema.safeParse(item.backgroundMotion).success).toBe(true);
  });

  it("gives a part either an entrance or a scroll effect, never both, and no scroll effect inside another", () => {
    const pic = image();
    const inner = image();
    const sec = row([col([pic]), col([inner])]);
    const rows = [one(heading("Hero", { level: 1 })), sec];
    const plan = cleanMotionPlan(
      {
        style: "lively",
        items: [
          { id: pic.id, enter: enter("pop"), scroll: { effect: "parallax" } },
          { id: sec.id, scroll: { effect: "parallax" } },
          { id: inner.id, scroll: { effect: "scale-up" } },
        ],
      },
      rows,
    )!;
    expect(byId(plan, pic.id)!.scroll).toBeUndefined();
    expect(byId(plan, sec.id)!.scroll).toBeDefined();
    expect(byId(plan, inner.id)).toBeUndefined();
  });

  it("leaves what the owner already chose alone", () => {
    const own = heading("Mine", { motion: { enter: { effect: "zoom-in" } } });
    const partlyOwn = button("B", { motion: { hover: { effect: "grow" } } });
    const sec = row([col([own, partlyOwn])], { backgroundMotion: { effect: "drift" }, background: picture });
    const rows = [one(heading("Hero", { level: 1 })), sec];
    const plan = cleanMotionPlan(
      {
        style: "elegant",
        items: [
          { id: own.id, enter: enter("fade-up") },
          { id: partlyOwn.id, enter: enter("fade-up"), hover: { effect: "lift" } },
          { id: sec.id, backgroundMotion: { effect: "parallax" } },
        ],
      },
      rows,
    )!;
    expect(byId(plan, own.id)).toBeUndefined();
    expect(byId(plan, partlyOwn.id)!.hover).toBeUndefined();
    expect(byId(plan, partlyOwn.id)!.enter).toBeDefined();
    expect(byId(plan, sec.id)).toBeUndefined();
  });

  it("writes its summary itself, whatever the model says", () => {
    const { rows, story, banner } = samplePage();
    const plan = cleanMotionPlan(
      {
        style: "elegant",
        summary: "<script>alert(1)</script> I made everything amazing!",
        items: [
          { id: story.id, enter: enter("fade-up") },
          { id: banner.id, backgroundMotion: { effect: "parallax" } },
        ],
      },
      rows,
    )!;
    expect(plan.summary).toBe("Added gentle entrances to 1 section and parallax on 1 background.");
    expect(plan.summary).not.toContain("<");
  });

  it("only produces motion the schemas accept", () => {
    const { rows } = samplePage();
    const everything = rows.flatMap((r) => [r.id, ...r.columns.flatMap((c) => [c.id, ...c.blocks.map((b) => b.id)])]);
    for (const style of ["subtle", "elegant", "lively"]) {
      const plan = cleanMotionPlan(
        {
          style,
          items: everything.map((id) => ({
            id,
            enter: enter("words"),
            hover: { effect: "tilt" },
            scroll: { effect: "rotate" },
            backgroundMotion: { effect: "drift" },
          })),
        },
        rows,
      );
      for (const item of plan?.items ?? []) {
        const { id, backgroundMotion, ...motion } = item;
        expect(id).toBeTruthy();
        expect(partMotionSchema.safeParse(motion).success).toBe(true);
        if (backgroundMotion) expect(backgroundMotionSchema.safeParse(backgroundMotion).success).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe("ruleBasedPlan", () => {
  it("is the same every time, elegant, and says it was not AI", () => {
    const { rows } = samplePage();
    const a = ruleBasedPlan(rows);
    expect(ruleBasedPlan(rows)).toEqual(a);
    expect(JSON.stringify(ruleBasedPlan(structuredClone(rows)))).toBe(JSON.stringify(a));
    expect(a.style).toBe("elegant");
    expect(a.aiUsed).toBe(false);
    expect(a.items.length).toBeGreaterThan(0);
  });

  it("builds a good page: the hero's words and the rest of its row on load, sections rising, pictures settling, parallax and lifts", () => {
    const { rows, h1, lead, cta, hero, photo, story, cards, banner } = samplePage();
    const plan = ruleBasedPlan(rows);
    expect(byId(plan, h1.id)!.enter).toMatchObject({ effect: "words", trigger: "load" });
    expect(byId(plan, lead.id)!.enter).toMatchObject({ effect: "fade-up", trigger: "load" });
    expect(byId(plan, cta.id)!.enter!.delay).toBeGreaterThan(byId(plan, lead.id)!.enter!.delay ?? 0);
    expect(byId(plan, cta.id)!.hover).toMatchObject({ effect: "lift" });
    expect(byId(plan, hero.id)!.backgroundMotion).toMatchObject({ effect: "parallax" });
    // Two columns with a picture come in from the two sides.
    expect(byId(plan, story.columns[0].id)!.enter!.effect).toBe("fade-right");
    expect(byId(plan, story.columns[1].id)!.enter!.effect).toBe("fade-left");
    expect(byId(plan, photo.id)).toBeUndefined();
    // Three cards: one entrance on the row, the columns in turn, and a lift on each card.
    expect(byId(plan, cards.id)!.enter).toMatchObject({ effect: "fade-up", stagger: 120 });
    // The last section sits on a picture: its content rises, and its picture moves.
    expect(byId(plan, banner.id)!.backgroundMotion).toBeDefined();
    expect(byId(plan, banner.columns[0].id)!.enter!.effect).toBe("fade-up");
  });

  it("puts a lone picture's entrance on the picture, and leaves separators alone", () => {
    const pic = image();
    const sep = one(block("separator"));
    const rows = [one(heading("Hi", { level: 1 })), one(pic), sep];
    const plan = ruleBasedPlan(rows);
    expect(byId(plan, pic.id)!.enter!.effect).toBe("zoom-out");
    expect(byId(plan, sep.id)).toBeUndefined();
  });

  it("describes what it did from the items, with the numbers", () => {
    const { rows } = samplePage();
    const plan = ruleBasedPlan(rows);
    const rowsAndColumns = plan.items.filter(
      (i) => i.enter && rows.some((r) => r.id === i.id || r.columns.some((c) => c.id === i.id)),
    ).length;
    expect(plan.summary).toMatch(/^Added gentle entrances to \d+ sections?/);
    expect(plan.summary).toContain(`${rowsAndColumns} section`);
    expect(plan.summary).toMatch(/parallax on 2 backgrounds/);
    expect(plan.summary).toMatch(/lift on hover for \d+ buttons? and \d+ cards\.$/);
  });

  it("is stable under checking: the cleaner leaves its plan as it is", () => {
    const { rows } = samplePage();
    const plan = ruleBasedPlan(rows);
    expect(cleanMotionPlan({ style: plan.style, items: plan.items }, rows)!.items).toEqual(plan.items);
  });

  it("skips modals, keeps to its caps and handles a page with nothing on it", () => {
    const popup = modal(heading("Popup"), button());
    const long = Array.from({ length: 40 }, (_, i) =>
      row([col([heading(`H${i}`), prose("t"), button()]), col([image()])], { background: picture }),
    );
    const plan = ruleBasedPlan([popup, ...long]);
    expect(plan.items.some((i) => i.id === popup.id)).toBe(false);
    expect(plan.items.filter((i) => i.enter).length).toBeLessThanOrEqual(CAPS.entrances);
    expect(plan.items.filter((i) => i.hover).length).toBeLessThanOrEqual(CAPS.hovers);
    expect(plan.items.filter((i) => i.backgroundMotion).length).toBeLessThanOrEqual(CAPS.backgrounds);
    const empty = ruleBasedPlan([]);
    expect(empty.items).toEqual([]);
    expect(empty.summary).toMatch(/^Nothing was added/);
  });

  it("does not plan what the owner already animated", () => {
    const { rows, h1, cards } = samplePage();
    h1.motion = { enter: { effect: "pop" } };
    cards.motion = { enter: { effect: "fade" } };
    const plan = ruleBasedPlan(rows);
    expect(byId(plan, h1.id)?.enter).toBeUndefined();
    expect(byId(plan, cards.id)?.enter).toBeUndefined();
  });

  it("uses only families of two effects", () => {
    const { rows } = samplePage();
    const families = new Set(ruleBasedPlan(rows).items.flatMap((i) => (i.enter ? [enterFamily(i.enter.effect)] : [])));
    expect(families.size).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------

describe("applyMotionPlan", () => {
  const strip = (rows: PageRow[]) =>
    JSON.parse(
      JSON.stringify(rows, (key, value) => (key === "motion" || key === "backgroundMotion" ? undefined : value)),
    );

  it("fills the empty slots and counts them", () => {
    const { rows, h1, cta, hero, story } = samplePage();
    const plan = ruleBasedPlan(rows);
    const applied = applyMotionPlan(rows, plan);
    expect(applied.changed).toBeGreaterThan(0);
    expect(applied.parts).toBeGreaterThan(0);
    expect(applied.parts).toBeLessThanOrEqual(applied.changed);
    const all = applied.rows;
    expect(all[0].backgroundMotion).toEqual(byId(plan, hero.id)!.backgroundMotion);
    expect(all[0].columns[0].blocks.find((b) => b.id === h1.id)!.motion!.enter).toEqual(byId(plan, h1.id)!.enter);
    expect(all[0].columns[0].blocks.find((b) => b.id === cta.id)!.motion!.hover).toEqual({
      effect: "lift",
      intensity: "subtle",
    });
    expect(all[1].columns[0].motion!.enter).toEqual(byId(plan, story.columns[0].id)!.enter);
    // Every row still passes the page's own schema.
    for (const r of all) expect(pageRowSchema.safeParse(r).success).toBe(true);
  });

  it("changes nothing but motion fields, and does not change its input", () => {
    const { rows } = samplePage();
    const before = structuredClone(rows);
    const applied = applyMotionPlan(rows, ruleBasedPlan(rows));
    expect(rows).toEqual(before);
    expect(strip(applied.rows)).toEqual(strip(before));
  });

  it("is idempotent: the second time it changes nothing", () => {
    const { rows } = samplePage();
    const plan = ruleBasedPlan(rows);
    const first = applyMotionPlan(rows, plan);
    const second = applyMotionPlan(first.rows, plan);
    expect(second.changed).toBe(0);
    expect(second.parts).toBe(0);
    expect(second.rows).toEqual(first.rows);
    expect(second.rows).toBe(first.rows);
  });

  it("keeps a part's own motion, slot by slot", () => {
    const own = button("Own", { motion: { enter: { effect: "zoom-in" } } });
    const rows = [one(heading("Hero", { level: 1 })), one(own)];
    const plan: MotionPlan = {
      style: "elegant",
      summary: "",
      aiUsed: true,
      items: [
        {
          id: own.id,
          enter: { effect: "fade-up" },
          hover: { effect: "lift" },
        },
        { id: rows[1].id, enter: { effect: "fade" } },
      ],
    };
    const applied = applyMotionPlan(rows, plan);
    const result = applied.rows[1].columns[0].blocks[0];
    expect(result.motion).toEqual({ enter: { effect: "zoom-in" }, hover: { effect: "lift" } });
    expect(applied.changed).toBe(2);
    expect(applied.parts).toBe(2);
  });

  it("puts a background effect only where there is a picture or video and none is set", () => {
    const withPicture = row([col([heading("a")])], { background: picture });
    const withColor = row([col([heading("b")])], {
      background: { type: "color", color: "#f5f5f5", opacity: 1 } as never,
    });
    const moving = row([col([heading("c")])], { background: picture, backgroundMotion: { effect: "drift" } });
    const plan: MotionPlan = {
      style: "elegant",
      summary: "",
      aiUsed: true,
      items: [withPicture, withColor, moving].map((r) => ({ id: r.id, backgroundMotion: { effect: "parallax" } })),
    };
    const applied = applyMotionPlan([withPicture, withColor, moving], plan);
    expect(applied.rows[0].backgroundMotion).toEqual({ effect: "parallax" });
    expect(applied.rows[1].backgroundMotion).toBeUndefined();
    expect(applied.rows[2].backgroundMotion).toEqual({ effect: "drift" });
    expect(applied.changed).toBe(1);
  });

  it("never touches a modal, and ignores ids that are not on the page", () => {
    const popup = modal(heading("Popup"), button());
    const plan: MotionPlan = {
      style: "elegant",
      summary: "",
      aiUsed: true,
      items: [
        { id: popup.id, enter: { effect: "fade" } },
        { id: popup.columns[0].blocks[1].id, hover: { effect: "lift" } },
        { id: "ghost", enter: { effect: "fade" } },
      ],
    };
    const applied = applyMotionPlan([popup], plan);
    expect(applied.changed).toBe(0);
    expect(applied.rows[0]).toBe(popup);
  });

  it("gives back the same rows when there is nothing to do", () => {
    const { rows } = samplePage();
    const applied = applyMotionPlan(rows, { style: "elegant", summary: "", aiUsed: false, items: [] });
    expect(applied.rows).toBe(rows);
    expect(applied).toMatchObject({ changed: 0, parts: 0 });
  });
});

describe("the catalogues and the rules agree", () => {
  it("has a family for every entrance that is not a text effect", () => {
    for (const [id, entry] of Object.entries(ENTER_EFFECTS)) {
      const textOnly = entry.targets.length === 1 && entry.targets[0] === "text";
      expect(enterFamily(id as never) === null).toBe(textOnly);
    }
  });

  it("gives every style only effects that exist", () => {
    for (const spec of Object.values(STYLES)) {
      for (const id of [...spec.enter, ...spec.text]) expect(Object.keys(ENTER_EFFECTS)).toContain(id);
      expect(spec.enter).toContain(spec.fallback);
      expect(spec.text).toContain(spec.textFallback);
    }
  });

  it("refuses headers only", () => {
    expect(motionPlanRefusal("header")).toMatch(/Headers/);
    expect(motionPlanRefusal("page")).toBeNull();
    expect(motionPlanRefusal("footer")).toBeNull();
    expect(motionPlanRefusal("article")).toBeNull();
  });
});

// Keeps the fixtures honest: the pages the tests use are pages the builder could save.
describe("the test pages", () => {
  it("are valid pages", () => {
    for (const r of samplePage().rows) expect(pageRowSchema.safeParse(r).success).toBe(true);
  });
});

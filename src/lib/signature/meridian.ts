import type { PackPicture } from "../content-pack-pages";
import type { ContentPack } from "../content-packs";
import { DESIGN_SNAPSHOT_VERSION, type DesignLayout } from "../design-presets";
import type { LaunchTheme } from "../launch-themes";
import type { PackPictureOf } from "../pack-designs";
import { newPageContent, type PageContent, type PageRow } from "../page-content";
import type { ThemeSettings } from "../theme";
import { coreStyles, em, lines, rem } from "../theme-kit";
import type { ThemeSection, ThemeSections } from "../theme-sections";

import { EYEBROW, heading, image, paragraph, phonesHidden, photo, product, productGrid, shot, site, text, twoButtons, uuid, type Look } from "./kit";

/**
 * Meridian, a signature theme (`docs/signature-themes.md`) and Kaizena Flow's first premium theme (D286, D287): a corporate consultancy,
 * modern, exclusive and professional, made from scratch. Ivory pages and deep navy, Newsreader in light display sizes with the turn of a
 * phrase in brass italics over Hanken Grotesk, a header that lies over a hero as wide as the screen, four principles divided by hairlines,
 * three practices as tall pictures, engagements to book, a numbered approach, a quote in large italics and a navy band to end on. Its demo
 * store, Aldren Partners, is a strategy and management consultancy whose engagements are booked as appointments, photographed in calm
 * offices and boardrooms (D270) and drawn by `scripts/theme-art/meridian.js` until then (`public/demo/themes/meridian/`). Data only; every
 * word passes `findClaims()` (`signature-themes.test.ts`).
 */

const ART = "/demo/themes/meridian";
const art = (name: string, width: number, height: number, alt: string): PackPicture => ({ url: `${ART}/${name}.webp`, width, height, alt });

const SERIF = "Newsreader";
const SANS = "Hanken Grotesk";
const NAVY = "#0e1726";
const IVORY = "#f3efe6";

// ---------------------------------------------------------------------------------------------------------------------------------------
// The demo store: Aldren Partners
// ---------------------------------------------------------------------------------------------------------------------------------------

/** Its engagements: each booked as an appointment of so many minutes with one of its two partners. */
const ENGAGEMENTS = [
  [
    "strategy-session",
    "Strategy session",
    "Ninety minutes with a partner on the question in front of your board: where you stand, the choices open to you and what each would ask of the organisation.",
    4900,
    "strategy",
    90,
    "A notebook, a fountain pen and a cup of coffee on a walnut boardroom table by a tall window",
    "a closed leather notebook, a black fountain pen and a white cup of coffee on a dark walnut boardroom table beside a tall window, soft morning light falling across the wood",
  ],
  [
    "growth-review",
    "Growth review",
    "Two hours on where growth will come from: your markets, your customers and the few bets worth making, with a written summary afterwards.",
    7900,
    "strategy",
    120,
    "A brass compass on a dark walnut desk in soft window light",
    "an antique brass compass lying open on a dark walnut desk, soft window light from the side and a deep shadow behind it",
  ],
  [
    "board-workshop",
    "Board workshop",
    "A half-day workshop for a board or management team: agree the priorities, the trade-offs and who owns each decision.",
    18900,
    "leadership",
    240,
    "An empty boardroom with leather chairs around a long walnut table and the city at dusk behind the glass",
    "an empty boardroom with eight dark leather chairs around a long walnut table, floor-to-ceiling windows behind it showing a city at dusk, warm lamps lit inside",
  ],
  [
    "leadership-coaching",
    "Leadership coaching",
    "An hour of one-to-one coaching for a chief executive or a new leader, in confidence, on the decisions and conversations ahead.",
    2900,
    "leadership",
    60,
    "Two leather armchairs facing each other beside a tall window",
    "two cognac leather armchairs facing each other beside a tall window with sheer curtains, a small round table between them, calm afternoon light",
  ],
  [
    "operations-review",
    "Operations review",
    "Three hours on how the work flows: where time and money are lost, what to fix first and how to measure that it worked.",
    12900,
    "operations",
    180,
    "A calm, orderly warehouse aisle with tall shelving in soft light",
    "a long, calm and orderly warehouse aisle with tall pale shelving and neatly stacked plain boxes, soft even light from skylights, polished concrete floor",
  ],
  [
    "change-kickoff",
    "Change programme kick-off",
    "A half-day session that turns a decision into a programme: the workstreams, the owners, the milestones and how progress is reported.",
    15900,
    "operations",
    240,
    "A glass wall covered in blank paper notes arranged in neat columns",
    "a glass wall in a bright meeting room covered in blank pale paper notes arranged in neat columns, a marker pen resting on the ledge below",
  ],
] as const;

export const MERIDIAN_PACK: ContentPack = {
  key: "consulting",
  version: 1,
  title: "Consultancy",
  summary: "A strategy and management consultancy whose engagements are booked online: the demo store made for the Meridian theme.",
  description:
    "Aldren Partners, a demo consultancy for boards and management teams, with strategy, leadership and operations engagements booked as appointments, its approach and an about page. Replace the services, words and pictures with your own.",
  category: "services",
  storeName: "Aldren Partners",
  headline: "Clarity for the decisions that matter",
  tagline: "Strategy, leadership and operations advice for boards and management teams, from the first question to a plan your organisation carries out.",
  points: [
    { title: "Listen first", text: "We start with your people, your numbers and your customers, before we say anything about what to do." },
    { title: "Decide together", text: "Options are laid out side by side with what each would ask of you, so the board makes the choice with its eyes open." },
    { title: "See it through", text: "Every recommendation leaves with an owner, a milestone and a way to tell whether it is working." },
  ],
  storyTitle: "Advice that sits at the table",
  story:
    "Aldren Partners was founded by two former executives who wanted advice to feel like a trusted colleague at the table: frank, discreet and accountable for what happens after the meeting.",
  about: [
    "Aldren Partners advises boards and management teams on strategy, leadership and operations. Every engagement is led by a partner, from the first conversation to the final review.",
    "This is a demo store made for the Meridian theme. Its services, words and pictures are examples: replace them with your own.",
  ],
  categories: [
    { slug: "strategy", name: "Strategy" },
    { slug: "leadership", name: "Leadership" },
    { slug: "operations", name: "Operations" },
  ],
  products: ENGAGEMENTS.map(([handle, title, description, price, category, minutes, picture]) => ({ handle, title, description, price, category, minutes, picture })),
  look:
    "Shot by a corporate and architectural photographer for a strategy consultancy's annual report, on a full-frame camera with a 35 mm or 50 mm lens. Natural light through tall windows, calm and composed, deep shadows and quiet highlights. Glass, stone, polished walnut, cognac leather and brushed brass in modern offices and boardrooms; a palette of deep navy, warm ivory and brass. Restrained and precise, true-to-life colour with a slightly cool grade, fine grain, nothing branded.",
  heroPicture: "A modern boardroom high above a city at dusk, its long table and chairs lit by warm lamps",
  storyPicture: "Two partners in conversation with a client at a boardroom table",
  art: {
    hero: art("hero", 2560, 1440, "A drawn boardroom high above a city at dusk, a long table and chairs in front of floor-to-ceiling windows"),
    story: art("story", 1600, 1200, "A drawn meeting at a walnut table by a tall window, three people seen as calm silhouettes"),
    city: art("city", 2400, 1200, "A drawn city of glass towers at night, their windows lit, under a deep navy sky"),
    "tile:strategy": art("tile-strategy", 1200, 1500, "A drawn brass compass on dark walnut in a beam of window light"),
    "tile:leadership": art("tile-leadership", 1200, 1500, "A drawn staircase of light stone rising through a tall atrium"),
    "tile:operations": art("tile-operations", 1200, 1500, "A drawn long aisle of tall pale shelving under skylights"),
    ...Object.fromEntries(ENGAGEMENTS.map(([handle, , , , , , alt]) => [`product:${handle}`, art(`service-${handle}`, 1600, 1200, alt)])),
  },
  photos: {
    hero: shot(
      "landscape",
      "A modern boardroom high above a city at dusk, its long table and chairs lit by warm lamps",
      "A modern boardroom high above a city at dusk, photographed from the end of a long walnut table with dark leather chairs on both sides, floor-to-ceiling windows behind showing glass towers and the last blue light of the evening, warm lamps lit inside. The table and the room fill the right two thirds of the frame; the left third is calm, dark window and sky with room for a headline.",
    ),
    story: shot(
      "landscape",
      "Two partners in conversation with a client at a boardroom table",
      "Two senior consultants, a woman and a man in their fifties in dark tailored suits, in conversation with a client across a walnut boardroom table, photographed from the side at eye level with a 50 mm lens, papers and a laptop closed between them, attentive and at ease, their faces lit by soft light from a tall window.",
      { people: true },
    ),
    city: shot(
      "landscape",
      "A city of glass towers at night seen from a high floor",
      "A city of glass office towers at night seen from a high floor through a window, their lit windows in neat grids, a calm river of car lights far below, a deep navy sky above. The lower third holds the towers; the middle and the top are calm sky with room for a heading.",
    ),
    "tile:strategy": shot(
      "portrait",
      "An antique brass compass on dark walnut in a beam of window light",
      "An antique brass compass lying open on a dark walnut table in a narrow beam of window light, photographed from above at an angle, deep shadow around it. It sits in the upper half of the frame; the lower half is calm, dark wood.",
    ),
    "tile:leadership": shot(
      "portrait",
      "A staircase of pale stone rising through a tall, light atrium",
      "A sweeping staircase of pale stone rising through a tall, light-filled atrium of a modern office building, photographed from below, clean lines and soft daylight from a glass roof, no one on the stairs.",
    ),
    "tile:operations": shot(
      "portrait",
      "A long, orderly warehouse aisle with tall pale shelving under skylights",
      "A long, calm and orderly warehouse aisle with tall pale shelving and neatly stacked plain boxes, photographed down its length from the middle, soft even light from skylights, polished concrete floor, no one in the aisle.",
    ),
    ...Object.fromEntries(
      ENGAGEMENTS.map(([handle, , , , , , alt, scene]) => [
        `product:${handle}`,
        shot("landscape", alt, `A still photograph for a consultancy's services page: ${scene}, composed with calm space around it.`),
      ]),
    ),
  },
  design: "meridian",
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// The demo store's pages
// ---------------------------------------------------------------------------------------------------------------------------------------

const eyebrow = (words: string) => text([words], "meridian-eyebrow", { ...EYEBROW, letterSpacing: em(0.28), weight: 600 });
const LEAD: Look = { size: rem(1.2), lineHeight: lines(1.65) };
const NUMERAL: Look = { family: SERIF, size: rem(3.5), lineHeight: lines(1), weight: 300 };

/** What Meridian's designed home page says: its demo store's words, or any store's when one of its sections is placed (D272). */
type MeridianWords = {
  hero: { eyebrow: string; heading: string; lead: string; first: [string, string]; second: [string, string] };
  principles: { title: string; text: string }[];
  practices: { eyebrow: string; heading: string; tiles: { picture: string; href: string; name: string; line: string }[] };
  services: { eyebrow: string; heading: string; lead: string; more: string };
  approach: { eyebrow: string; heading: string; steps: { title: string; text: string }[] };
  quote: { words: string; by: string };
  story: { eyebrow: string; heading: string; text: string; button: [string, string] };
  finale: { heading: string; lead: string; button: [string, string] };
};

/** Aldren Partners' own words. */
const aldrenWords = (pack: ContentPack): MeridianWords => ({
  hero: {
    eyebrow: "Strategy · Leadership · Operations",
    heading: "Clarity for the decisions <em>that matter</em>",
    lead: pack.tagline,
    first: ["Book a strategy session", "/p/strategy-session"],
    second: ["Our engagements", "/products"],
  },
  principles: [
    { title: "Independent", text: "We sell no software and take no commission: our advice answers to you alone." },
    { title: "Partner-led", text: "The partner you meet first is the one who leads the work." },
    { title: "Discreet", text: "What is said at your table stays at your table." },
    { title: "Accountable", text: "We agree with you how success will be measured, before we begin." },
  ],
  practices: {
    eyebrow: "Our practices",
    heading: "Three ways we <em>help</em>",
    tiles: [
      { picture: "tile:strategy", href: "/category/strategy", name: "Strategy", line: "Where to play, how to win and what to stop" },
      { picture: "tile:leadership", href: "/category/leadership", name: "Leadership", line: "Boards and leaders who decide well together" },
      { picture: "tile:operations", href: "/category/operations", name: "Operations", line: "Work that flows from decision to result" },
    ],
  },
  services: {
    eyebrow: "Engagements",
    heading: "Start with a <em>conversation</em>",
    lead: "Book a first session online with one of our partners, at a time that suits you.",
    more: "See all engagements",
  },
  approach: { eyebrow: "Our approach", heading: "How we <em>work</em>", steps: pack.points },
  quote: { words: "Good advice is measured by the decisions it makes easier.", by: "The partners of Aldren" },
  story: { eyebrow: "About us", heading: pack.storyTitle, text: pack.story, button: ["Meet the firm", "/about"] },
  finale: {
    heading: "Let us talk about <em>what comes next</em>",
    lead: "A first strategy session is ninety minutes with a partner, in our office or yours.",
    button: ["Book a strategy session", "/p/strategy-session"],
  },
});

/** The words a section brings to any store: what to write there, never Aldren Partners'. */
const SECTION_WORDS: MeridianWords = {
  hero: {
    eyebrow: "Welcome",
    heading: "Your <em>headline</em> here",
    lead: "One or two sentences about what you offer and who it is for.",
    first: ["Get started", "/products"],
    second: ["Learn more", "#story"],
  },
  principles: [
    { title: "First", text: "A short sentence about what you stand for." },
    { title: "Second", text: "A short sentence about how you work." },
    { title: "Third", text: "A short sentence about your customers." },
    { title: "Fourth", text: "A short sentence about what they get." },
  ],
  practices: {
    eyebrow: "What we do",
    heading: "Three <em>areas</em>",
    tiles: [
      { picture: "tile:strategy", href: "/products", name: "First area", line: "A line about what it covers" },
      { picture: "tile:leadership", href: "/products", name: "Second area", line: "A line about what it covers" },
      { picture: "tile:operations", href: "/products", name: "Third area", line: "A line about what it covers" },
    ],
  },
  services: { eyebrow: "Our services", heading: "What you can <em>book</em>", lead: "A sentence about how to get started.", more: "See everything" },
  approach: {
    eyebrow: "How it works",
    heading: "Three <em>steps</em>",
    steps: [
      { title: "The first step", text: "A sentence about how it starts." },
      { title: "The second step", text: "A sentence about what happens next." },
      { title: "The last step", text: "A sentence about what the customer gets." },
    ],
  },
  quote: { words: "A sentence you would like every visitor to remember.", by: "Your name" },
  story: { eyebrow: "Our story", heading: "Where it began", text: "A few sentences about who you are and why you do it.", button: ["About us", "/about"] },
  finale: { heading: "Your <em>last</em> word", lead: "A sentence that invites a visitor to take the next step.", button: ["Get in touch", "/about"] },
};

/**
 * Meridian's designed rows: the hero as wide as the screen, four principles between hairlines, three practices as tall pictures, the
 * engagements to book, the approach in three numbered steps, a quote, the story, and a navy band over the city to end on.
 */
function meridianSections(words: MeridianWords, picture: PackPictureOf): { sections: ThemeSection[]; page: PageRow[] } {
  const hero = {
    id: uuid(),
    type: "row",
    layout: "1",
    width: "full",
    height: 100,
    align: "middle",
    sectionStyle: "hero",
    className: "meridian-hero",
    background: photo(picture("hero"), 52, NAVY),
    columns: [
      {
        id: uuid(),
        className: "meridian-hero-copy",
        typography: { text: { color: IVORY } },
        blocks: [
          eyebrow(words.hero.eyebrow),
          heading(words.hero.heading, 1, "meridian-display", { color: IVORY }),
          text([words.hero.lead], "meridian-lead meridian-on-dark", LEAD),
          twoButtons(words.hero.first, words.hero.second, { shape: "square", className: "meridian-hero-buttons" }),
        ],
      },
    ],
  };
  const principles = {
    id: uuid(),
    type: "row",
    layout: "4",
    sectionStyle: "plain",
    className: "meridian-principles",
    columns: words.principles.map((principle) => ({
      id: uuid(),
      className: "meridian-principle",
      blocks: [heading(principle.title, 3, "meridian-principle-title"), text([principle.text])],
    })),
  };
  const tile = (item: MeridianWords["practices"]["tiles"][number]) => ({
    id: uuid(),
    className: "meridian-tile",
    link: { href: item.href, label: item.name },
    background: photo(picture(item.picture), 30, NAVY),
    typography: { text: { color: IVORY } },
    blocks: [heading(item.name, 3, "meridian-tile-name", { color: IVORY }), text([item.line], "meridian-tile-line meridian-on-dark")],
  });
  const practices = {
    id: uuid(),
    type: "row",
    layout: "3",
    sectionStyle: "plain",
    className: "meridian-section meridian-practices",
    // Close under the heading that opens it.
    style: { padding: { top: 40, right: 20, bottom: 104, left: 20 } },
    at: { sm: { style: { padding: { top: 24, right: 18, bottom: 64, left: 18 } } } },
    columns: words.practices.tiles.map(tile),
  };
  // A section's small line and heading in a row of their own, over the row it opens.
  const headingRow = (line: string, words: string) => ({
    id: uuid(),
    type: "row",
    layout: "1",
    sectionStyle: "plain",
    className: "meridian-section meridian-heading-row",
    style: { padding: { top: 104, right: 20, bottom: 0, left: 20 } },
    at: { sm: { style: { padding: { top: 64, right: 18, bottom: 0, left: 18 } } } },
    columns: [{ id: uuid(), blocks: [eyebrow(line), heading(words, 2)] }],
  });
  const practicesHeading = headingRow(words.practices.eyebrow, words.practices.heading);
  const approachHeading = headingRow(words.approach.eyebrow, words.approach.heading);
  const services = {
    id: uuid(),
    type: "row",
    layout: "1",
    width: "full",
    contentWidth: "content",
    sectionStyle: "muted",
    htmlId: "engagements",
    className: "meridian-section meridian-services",
    columns: [
      {
        id: uuid(),
        blocks: [
          eyebrow(words.services.eyebrow),
          heading(words.services.heading, 2),
          text([words.services.lead], "meridian-lead", LEAD),
          productGrid(6, { columns: { mobile: 1, tablet: 2, desktop: 3 }, gap: 32 }),
          { id: uuid(), type: "button", label: words.services.more, href: "/products", variant: "outline", shape: "square", align: "center", className: "meridian-more" },
        ],
      },
    ],
  };
  const approach = {
    id: uuid(),
    type: "row",
    layout: "3",
    sectionStyle: "plain",
    className: "meridian-section meridian-steps",
    style: { padding: { top: 40, right: 20, bottom: 104, left: 20 } },
    at: { sm: { style: { padding: { top: 24, right: 18, bottom: 64, left: 18 } } } },
    columns: words.approach.steps.map((step, i) => ({
      id: uuid(),
      className: "meridian-step",
      blocks: [text([`0${i + 1}`], "meridian-numeral", NUMERAL), heading(step.title, 3), text([step.text])],
    })),
  };
  const quote = {
    id: uuid(),
    type: "row",
    layout: "1",
    sectionStyle: "quote",
    className: "meridian-section meridian-quote",
    columns: [
      {
        id: uuid(),
        typography: { text: { align: "center" } },
        blocks: [text([words.quote.words], "meridian-quote-words"), text([words.quote.by], "meridian-quote-by", { ...EYEBROW, letterSpacing: em(0.24), family: SANS, style: "normal" })],
      },
    ],
  };
  const story = {
    id: uuid(),
    type: "row",
    layout: "2",
    align: "middle",
    sectionStyle: "plain",
    htmlId: "story",
    className: "meridian-section meridian-story",
    columns: [
      { id: uuid(), width: 55, blocks: [image(picture("story"), "meridian-frame")] },
      {
        id: uuid(),
        width: 45,
        className: "meridian-story-copy",
        blocks: [
          eyebrow(words.story.eyebrow),
          heading(words.story.heading, 2),
          text([words.story.text], "meridian-lead", LEAD),
          { id: uuid(), type: "button", label: words.story.button[0], href: words.story.button[1], variant: "outline", shape: "square" },
        ],
      },
    ],
  };
  const finale = {
    id: uuid(),
    type: "row",
    layout: "1",
    width: "full",
    height: 70,
    align: "middle",
    sectionStyle: "contrast",
    className: "meridian-finale",
    background: photo(picture("city"), 58, NAVY),
    columns: [
      {
        id: uuid(),
        typography: { text: { align: "center", color: IVORY } },
        blocks: [
          heading(words.finale.heading, 2, "meridian-display", { color: IVORY, size: rem(4) }),
          text([words.finale.lead], "meridian-lead meridian-on-dark", LEAD),
          { id: uuid(), type: "button", label: words.finale.button[0], href: words.finale.button[1], variant: "filled", shape: "square", align: "center", size: "lg" },
        ],
      },
    ],
  };
  const section = (key: string, name: string, description: string, thumb: string | null, row: unknown): ThemeSection => ({
    key,
    name,
    description,
    thumb,
    row: row as PageRow,
  });
  const sections = [
    section("hero", "Full-screen hero", "Your headline over a picture as wide as the screen, with two buttons", "hero", hero),
    section("principles", "Four principles", "Four short statements side by side, divided by fine lines", null, principles),
    section("heading", "Section heading", "A small line over a heading, to open the section under it", null, practicesHeading),
    section("practices", "Three tall pictures", "Three areas side by side, each a tall picture with its name and a line", "tile:strategy", practices),
    section("services", "Services to book", "A heading, a line and your services in three columns, with a link to all", null, services),
    section("approach", "Three numbered steps", "Three short steps under large, light numerals", null, approach),
    section("quote", "Quote", "One sentence in large italics, with who said it", null, quote),
    section("story", "Story", "A picture in a fine frame beside a few sentences and a button", "story", story),
    section("finale", "Closing band", "A heading, a line and a button over a picture as wide as the screen", "city", finale),
  ];
  // The home page's order: each section, with the approach opened by a heading row of its own.
  const page = [hero, principles, practicesHeading, practices, services, approachHeading, approach, quote, story, finale] as unknown as PageRow[];
  return { sections, page };
}

/** Aldren Partners' home page: Meridian's rows in its own words. */
export function meridianHomePage(pack: ContentPack, picture: PackPictureOf): PageContent {
  return { ...newPageContent(), title: "Home", slug: "welcome", rows: meridianSections(aldrenWords(pack), picture).page };
}

/** Meridian's sections as an owner places them (D272): its rows in words for any store. */
export const MERIDIAN_SECTIONS: ThemeSections = (picture) => meridianSections(SECTION_WORDS, picture).sections;

/** Aldren Partners' about page: its name over the meeting, then its words beside the city at night. */
export function meridianAboutPage(pack: ContentPack, picture: PackPictureOf): PageContent {
  const rows = [
    {
      id: uuid(),
      type: "row",
      layout: "1",
      width: "full",
      height: 62,
      align: "bottom",
      sectionStyle: "hero",
      className: "meridian-about-hero",
      background: photo(picture("story"), 55, NAVY),
      columns: [
        {
          id: uuid(),
          className: "meridian-hero-copy",
          typography: { text: { color: IVORY } },
          blocks: [eyebrow("About us"), heading(`About <em>${pack.storeName}</em>`, 1, "meridian-display", { color: IVORY })],
        },
      ],
    },
    {
      id: uuid(),
      type: "row",
      layout: "2",
      align: "middle",
      sectionStyle: "plain",
      className: "meridian-section",
      columns: [
        {
          id: uuid(),
          blocks: [
            heading(pack.storyTitle, 2),
            text([pack.story, ...pack.about]),
            { id: uuid(), type: "button", label: "See our engagements", href: "/products", variant: "filled", shape: "square" },
          ],
        },
        { id: uuid(), blocks: [image(picture("city"), "meridian-frame")] },
      ],
    },
  ];
  return { ...newPageContent(), title: "About us", slug: "about", rows: rows as unknown as PageRow[] };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// The theme
// ---------------------------------------------------------------------------------------------------------------------------------------

const header: DesignLayout = {
  css: "",
  overlay: { where: "front", textColor: "#ffffff" },
  menus: { "meridian-header-menu": "header" },
  rows: [
    {
      id: "meridian-header-row",
      type: "row",
      // Its band spans the screen; its content keeps to the page's width.
      width: "full",
      contentWidth: "content",
      layout: "fit-sides",
      stack: false,
      align: "middle",
      className: "meridian-header",
      style: { padding: { top: 22, right: 32, bottom: 22, left: 32 } },
      at: { sm: { gap: 8, style: { padding: { top: 14, right: 16, bottom: 14, left: 16 } } } },
      columns: [
        { id: "meridian-header-brand", inline: true, blocks: [site("meridian-header-menu-button", "menuButton"), site("meridian-header-logo", "logo", { className: "meridian-logo" })] },
        {
          id: "meridian-header-nav",
          blocks: [
            {
              id: "meridian-header-menu",
              type: "menu",
              align: "center",
              className: "meridian-nav",
              itemHover: { kind: "line", edge: "below", travel: "grow", thickness: 1, active: true },
              ...phonesHidden,
            },
          ],
        },
        {
          id: "meridian-header-tools",
          inline: true,
          justify: "end",
          blocks: [site("meridian-header-search", "search"), site("meridian-header-account", "account", phonesHidden), site("meridian-header-cart", "cart")],
        },
      ],
    },
  ] as unknown as PageRow[],
};

const footer: DesignLayout = {
  css: "",
  menus: { "meridian-footer-menu": "footer" },
  rows: [
    {
      id: "meridian-footer-row",
      type: "row",
      // Its navy band spans the screen; its content keeps to the page's width.
      width: "full",
      contentWidth: "content",
      layout: "4",
      className: "meridian-footer",
      background: { type: "color", color: NAVY },
      typography: { text: { color: IVORY } },
      style: { padding: { top: 96, right: 32, bottom: 64, left: 32 } },
      columns: [
        {
          id: "meridian-footer-brand",
          blocks: [
            site("meridian-footer-logo", "logo", { className: "meridian-logo" }),
            {
              id: "meridian-footer-line",
              type: "richText",
              className: "meridian-footer-line",
              doc: { type: "doc", content: [paragraph("Considered advice, carefully given.")] },
              typography: { text: { family: SERIF, style: "italic", weight: 300, size: rem(1.6), lineHeight: lines(1.3) } },
            },
          ],
        },
        { id: "meridian-footer-links", blocks: [{ id: "meridian-footer-menu", type: "menu", direction: "column" }] },
        {
          id: "meridian-footer-help",
          blocks: [
            site("meridian-footer-cookies", "cookies"),
            site("meridian-footer-withdrawal", "withdrawal"),
            site("meridian-footer-markets", "markets", { display: "list", direction: "column" }),
          ],
        },
        { id: "meridian-footer-company", blocks: [site("meridian-footer-business", "business")] },
      ],
    },
  ] as unknown as PageRow[],
};

const productLayout: DesignLayout = {
  css: "",
  menus: {},
  rows: [
    {
      id: "meridian-product-row",
      type: "row",
      layout: "2",
      className: "meridian-product",
      style: { padding: { top: 40, right: 20, bottom: 80, left: 20 } },
      columns: [
        { id: "meridian-product-media", className: "meridian-gallery", blocks: [product("meridian-product-back", "back"), product("meridian-product-gallery", "gallery")] },
        {
          id: "meridian-product-details",
          className: "meridian-buybox",
          blocks: [
            product("meridian-product-title", "title"),
            product("meridian-product-price", "price"),
            product("meridian-product-campaigns", "campaigns"),
            product("meridian-product-notice", "notice"),
            product("meridian-product-host", "host"),
            product("meridian-product-buy", "buy"),
            product("meridian-product-withdrawal", "withdrawal"),
            product("meridian-product-description", "description"),
            product("meridian-product-fields", "fields"),
            product("meridian-product-safety", "safety"),
          ],
        },
      ],
    },
    {
      id: "meridian-related-row",
      type: "row",
      layout: "1",
      className: "meridian-section",
      columns: [
        {
          id: "meridian-related",
          blocks: [product("meridian-product-related", "related", { heading: "Explore further", limit: 3, columns: 3, at: { sm: { columns: 1 } } })],
        },
      ],
    },
  ] as unknown as PageRow[],
};

/**
 * Meridian's stylesheet: light display serifs with the turn of a phrase in brass italics, small capitals spaced wide over a short brass rule,
 * a header that is glass over the hero and ivory with a hairline elsewhere, a hero whose copy rises in on load, principles divided by
 * hairlines, tall practice pictures whose brass rule grows on hover, engagement cards with a fine frame, light numerals, a quote in large
 * italics, pictures in a fine inset frame and a navy footer. Written for the site's own classes and Meridian's (`meridian-…`); every motion
 * stops for reduced motion.
 */
const CSS = `
:root, :scope[data-site-css] { --meridian-line: color-mix(in srgb, var(--foreground) 14%, transparent); --meridian-brass: var(--accent); }
@keyframes meridian-rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }

h1, h2, h3 { text-wrap: balance; overflow-wrap: break-word; letter-spacing: -.01em; }
h1 em, h2 em, h3 em { color: var(--accent); font-style: italic; }
.meridian-display em { color: #d8bd84; }
.meridian-eyebrow.meridian-eyebrow .rich-text p { color: var(--accent); margin: 0 0 1.25rem; display: flex; align-items: center; gap: .9rem; }
.meridian-eyebrow.meridian-eyebrow .rich-text p::before { content: ""; width: 32px; height: 1px; background: currentColor; }
.meridian-lead.meridian-lead .rich-text p { color: var(--muted); max-width: 36rem; }
.meridian-on-dark.meridian-on-dark .rich-text p { color: rgba(243,239,230,.84); }
.meridian-finale .meridian-lead.meridian-lead .rich-text p { margin-inline: auto; }

.button-primary, .kz-btn { text-transform: uppercase; letter-spacing: .14em; font-size: .78rem; font-weight: 600; }

.meridian-header { position: relative; }
.meridian-header::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 1px; background: var(--meridian-line); }
html[data-overlay-on] .meridian-header { background: linear-gradient(180deg, rgba(14,23,38,.6), transparent); }
html[data-overlay-on] .meridian-header::after { background: rgba(243,239,230,.18); }
.meridian-logo a > span { font-family: var(--site-heading-font, serif); font-size: 1.6rem; font-weight: 400; letter-spacing: .01em; }
.meridian-nav a { font-size: .74rem; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; }

.meridian-hero-copy { max-width: 46rem; }
.meridian-hero-copy > * { animation: meridian-rise .9s cubic-bezier(.2,.7,.2,1) both; }
.meridian-hero-copy > *:nth-child(2) { animation-delay: .08s; }
.meridian-hero-copy > *:nth-child(3) { animation-delay: .16s; }
.meridian-hero-copy > *:nth-child(4) { animation-delay: .24s; }
.meridian-hero h1 { font-size: clamp(2.8rem, 6vw, 5.5rem); line-height: 1.02; font-weight: 300; }
.meridian-hero .meridian-eyebrow.meridian-eyebrow .rich-text p, .meridian-about-hero .meridian-eyebrow.meridian-eyebrow .rich-text p { color: #d8bd84; }
.meridian-hero .kz-btn-outline, .meridian-finale .kz-btn-outline { color: #f3efe6; border-color: rgba(243,239,230,.7); }
.meridian-hero .kz-btn-outline:is(:hover, :focus-visible) { background: #f3efe6; color: #0e1726; }
@media (max-width: 767px) { .meridian-logo a > span { font-size: 1.25rem; } }

.meridian-principles .meridian-principle { padding: 1.6rem 1.6rem 0 0; border-top: 1px solid var(--accent); }
@media (min-width: 768px) { .meridian-principles .meridian-principle + .meridian-principle { border-left: 1px solid var(--meridian-line); padding-left: 1.6rem; } }
.meridian-principle-title h3, h3.meridian-principle-title { font-size: 1.5rem; font-weight: 400; }

.meridian-section h2 { margin-bottom: 1.25rem; }
.meridian-practices { gap: 20px; }
.meridian-tile { min-height: 64vh; display: flex; flex-direction: column; justify-content: flex-end; padding: 36px; position: relative; isolation: isolate; overflow: hidden; }
.meridian-tile::before { content: ""; position: absolute; inset: 0; z-index: -1; background: linear-gradient(180deg, transparent 40%, rgba(14,23,38,.86)); pointer-events: none; }
.meridian-tile::after { content: ""; position: absolute; left: 36px; bottom: 28px; height: 1px; width: 40px; background: #d8bd84; transition: width var(--kz-hover-dur, .45s) ease; }
.meridian-tile:hover::after { width: calc(100% - 72px); }
.meridian-tile h3 { font-size: clamp(2rem, 3vw, 2.6rem); font-weight: 300; margin: 0 0 .4rem; }
.meridian-tile-line.meridian-tile-line .rich-text p { margin: 0 0 1.4rem; }
@media (max-width: 767px) { .meridian-tile { min-height: 52vh; padding: 28px; } .meridian-tile::after { left: 28px; } }

.meridian-services .meridian-lead { margin-bottom: 2.5rem; }
.meridian-more { margin-top: 2.6rem; }
.product-card { position: relative; background: var(--background); border: 1px solid var(--meridian-line); padding: 14px 14px 22px; transition: border-color var(--kz-hover-dur, .3s) ease, transform var(--kz-hover-dur, .3s) ease; }
.product-card:hover { border-color: var(--accent); transform: translateY(-3px); }
.product-card h3 { font-family: var(--site-heading-font, serif); font-size: 1.45rem; font-weight: 400; letter-spacing: 0; }
.product-card-image { background: var(--surface); }

.meridian-numeral.meridian-numeral .rich-text p { color: var(--accent); margin: 0 0 1.4rem; font-variant-numeric: lining-nums; }
.meridian-step { padding-right: 1.6rem; }
.meridian-quote-words.meridian-quote-words .rich-text p { font-family: var(--site-heading-font, serif); font-style: italic; font-weight: 300; font-size: clamp(1.8rem, 3.6vw, 3rem); line-height: 1.25; max-width: 52rem; margin: 0 auto 1.6rem; }
.meridian-quote-words.meridian-quote-words .rich-text p::before { content: "\\201C"; display: block; color: var(--accent); font-size: 2.4em; line-height: .5; margin-bottom: .5rem; font-style: normal; }
.meridian-quote-by.meridian-quote-by .rich-text p { color: var(--accent); }

.meridian-frame img { padding: 14px; border: 1px solid var(--meridian-line); background: var(--background); }
.meridian-story-copy { padding-left: clamp(0px, 4vw, 56px); }
.meridian-finale { text-align: center; }

.meridian-footer { --background: #0e1726; --surface: #16223a; --foreground: #f3efe6; --muted: #a9b0bd; --border: #26324a; color: var(--foreground); }
.meridian-footer .meridian-logo a > span { color: #f3efe6; }
.meridian-footer a { color: inherit; }
.meridian-footer-line { margin-top: 1rem; }
.meridian-footer-line.meridian-footer-line .rich-text p { color: #d8bd84; }

.meridian-buybox h1 { font-size: clamp(2.2rem, 4vw, 3.4rem); line-height: 1.05; font-weight: 300; }
.meridian-gallery img { border: 1px solid var(--meridian-line); }
@media (min-width: 1024px) { .meridian-buybox { position: sticky; top: 110px; align-self: start; padding-left: 24px; } }

@media (prefers-reduced-motion: reduce) {
  .meridian-hero-copy > * { animation: none; }
  .product-card:hover { transform: none; }
  .meridian-tile::after { transition: none; }
}
`.trim();

/** The core section styles at Meridian's scale: a light hero heading that keeps to the screen on phones, generous room between sections. */
function meridianStyles() {
  const styles = coreStyles({ heroSize: 5.5, band: NAVY, bandText: IVORY, space: 104, quoteFamily: SERIF });
  return {
    ...styles,
    hero: {
      ...styles.hero,
      row: { style: { padding: { top: 180, right: 32, bottom: 120, left: 32 } }, at: { sm: { style: { padding: { top: 128, right: 18, bottom: 72, left: 18 } } } } },
      h1: { ...styles.hero.h1, at: { md: { typography: { text: { size: rem(4.5) } } }, sm: { typography: { text: { size: rem(2.9) } } } } },
    },
    plain: { row: { style: { padding: { top: 104, right: 20, bottom: 104, left: 20 } }, at: { sm: { style: { padding: { top: 64, right: 18, bottom: 64, left: 18 } } } } } },
  };
}

const LIGHT = { background: "#f6f4ef", surface: "#ebe6db", text: NAVY, muted: "#4c5566", border: "#d9d2c3", accent: "#86672b", accentText: "#ffffff" };
const DARK = { background: "#0b1220", surface: "#131c2e", text: "#eef0f4", muted: "#9aa4b5", border: "#243049", accent: "#d4b46f", accentText: "#0b1220" };

const settings: ThemeSettings = {
  mode: "light",
  visitorSwitch: false,
  light: LIGHT,
  dark: DARK,
  fonts: { heading: SERIF, body: SANS },
  headings: { weight: "normal", case: "normal" },
  buttons: { style: "filled", corners: "square" },
  corners: { cards: "none", fields: "none" },
  layout: { width: "wide", maxWidth: 1280, headerAlign: "left", headerBackground: "page" },
  productCards: { image: "landscape", style: "plain", align: "left" },
  elements: {
    h1: { typography: { text: { size: rem(5), lineHeight: lines(1.04), weight: 300 } }, at: { sm: { typography: { text: { size: rem(2.9) } } } } },
    h2: { typography: { text: { size: rem(3.2), lineHeight: lines(1.08), weight: 300 } }, at: { sm: { typography: { text: { size: rem(2.2) } } } } },
    h3: { typography: { text: { size: rem(1.5), lineHeight: lines(1.2), weight: 400 } } },
    p: { typography: { text: { size: rem(1.0625), lineHeight: lines(1.7) } } },
    button: { typography: { text: { weight: 600 } } },
  },
  sectionStyles: meridianStyles(),
  hover: { button: "darken", duration: 260 },
} as unknown as ThemeSettings;

export const MERIDIAN: LaunchTheme = {
  key: "meridian",
  version: 1,
  signature: true,
  title: "Meridian",
  summary: "A consultancy at ease in the boardroom: light serifs, deep navy and brass, and services booked online.",
  description:
    "Made from scratch for consultancies, advisers and professional firms. Ivory pages and deep navy, Newsreader in light display sizes with the turn of a phrase in brass italics over Hanken Grotesk, a header that lies over a hero as wide as the screen, four principles divided by fine lines, three practices as tall pictures, services to book online, a numbered approach, a quote in large italics and a navy band to end on. Its demo store, Aldren Partners, is a strategy and management consultancy.",
  notes: null,
  content: "consulting",
  listing: {
    kinds: ["services"],
    styles: ["minimal", "classic"],
    highlights: {
      devices: { title: "Composed on every screen", text: "Meridian's light serifs, navy hero and brass details on a computer and on a phone." },
      collage: { title: "Sections with presence", text: "A hero as wide as the screen, principles divided by fine lines, practices as tall pictures and a navy band over the city to end on." },
      closeup: { title: "A service page that books", text: "The picture in a fine frame beside the price and the times to book, kept in view." },
    },
  },
  snapshot: { v: DESIGN_SNAPSHOT_VERSION, theme: { base: "minimal", settings }, header, footer, productLayout, css: CSS },
  sections: MERIDIAN_SECTIONS,
  presets: [
    {
      key: "midnight",
      name: "Midnight",
      changes: { mode: "dark" },
    },
    {
      key: "harbour",
      name: "Harbour",
      changes: {
        light: { background: "#f3f5f7", surface: "#e3e9ee", text: "#0f1d2b", muted: "#4a5a6a", border: "#cfd8e0", accent: "#1d4e6e", accentText: "#ffffff" },
        dark: { background: "#0a141d", surface: "#122230", text: "#e9f0f5", muted: "#94a7b7", border: "#203546", accent: "#7fb6d9", accentText: "#0a141d" },
      },
    },
  ],
  // Kaizena Flow's first premium theme (D286): what a store pays once, without VAT, set when the theme is first made; the platform's
  // admin changes it on the theme's page.
  prices: [
    { currency: "NOK", amountMinor: 349000 },
    { currency: "SEK", amountMinor: 349000 },
    { currency: "DKK", amountMinor: 249000 },
    { currency: "EUR", amountMinor: 29900 },
  ],
};

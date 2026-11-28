/**
 * Kaizena Life's pages (D916, `docs/life-site-move.md`), each built from Life's own words in one language. The ids are fixed, so a page
 * built in English and in Norwegian differ only in their words, and a second import updates the same parts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { htmlToRichText } from "@/lib/html-rich-text";

import { APP_SIGN_IN, APP_TITLE, LIFE, badge, box, buttons, cards, column, doc, eyebrowText, glow, heading, mutedText, row, text, type Json, type Words } from "./kit";

export type LifePage = { slug: string; title: string; seo: { title: string; description: string }; rows: Json[] };
/** What the importer reads from the store before building: the Plans component of its Pricing page, so the prices stay the store's. */
export type StoreFacts = { plans: Json | null; plansCategory: string | null };

type Item = { title: string; body: string };

/** The front page (`/`): hero with its glow, badge and app preview; six features; the band for the deliberate few; how it works; the call. */
export function frontPage(w: Words): LifePage {
  const m = (key: string) => w.t("marketing", key);
  const features = w.raw<Item[]>("marketing", "home.features");
  const steps = w.raw<Item[]>("marketing", "home.steps");
  const points = w.raw<string[]>("marketing", "home.exclusivePoints");
  const sidebar = w.raw<string[]>("marketing", "home.mockup.sidebar");
  const dueTasks = w.raw<string[]>("marketing", "home.mockup.dueTasks");
  const icons = ["bot", "video", "calendarDays", "wallet", "radio", "listChecks"];
  return {
    slug: "home",
    title: APP_TITLE,
    seo: { title: m("home.metaTitle"), description: m("home.metaDescription") },
    rows: [
      row(
        "home-hero",
        [
          column("home-hero-badge", [badge("home-badge", m("home.badge"))], { inline: true, justify: "center" }),
          column("home-hero-text", [
            heading("home-h1", m("home.heroTitle"), 1, { typography: { text: { size: { value: 64, unit: "px" }, lineHeight: { value: 1.05, unit: "" } } }, at: { sm: { typography: { text: { size: { value: 40, unit: "px" } } } } } }),
            text("home-lead", doc(m("home.heroBody")), { typography: mutedText(19), style: { padding: { top: 0, right: 80, bottom: 0, left: 80 } }, at: { sm: { style: { padding: { top: 0, right: 0, bottom: 0, left: 0 } } } } }),
            text("home-definition", doc(m("home.definition")), { typography: mutedText(15) }),
            buttons("home-actions", { label: m("home.getStarted"), href: "/plans" }, { label: m("home.seePricing"), href: "/plans" }),
            text("home-member", doc([`${m("home.alreadyMember")} `, { text: m("home.signIn"), href: APP_SIGN_IN }]), { typography: mutedText(13) }),
          ], { style: { padding: { top: 0, right: 64, bottom: 48, left: 64 } }, at: { sm: { style: { padding: { top: 0, right: 0, bottom: 32, left: 0 } } } } }),
          column("home-hero-app", [
            {
              id: "home-app",
              type: "appPreview",
              frame: "window",
              bar: "kaizenalife.com/app/today",
              sideTitle: APP_TITLE,
              side: sidebar.map((item, i) => ({ id: `home-app-side${i + 1}`, text: item })),
              alt: m("home.metaDescription"),
              parts: [
                { id: "home-app-today", kind: "title", title: m("home.mockup.today"), aside: "" },
                { id: "home-app-brief", kind: "briefing", icon: "sparkles", title: m("home.mockup.briefing"), lines: 3, boxed: true },
                { id: "home-app-due", kind: "checklist", title: m("home.mockup.dueToday"), mark: "tick", half: true, boxed: true, items: dueTasks.map((task, i) => ({ id: `home-app-due${i + 1}`, text: task, done: i === 0 })) },
                { id: "home-app-cash", kind: "bars", icon: "wallet", title: m("home.mockup.cashflow"), aside: "", values: [55, 80, 40, 95, 65], soft: 0, captionStart: "", captionEnd: "", half: true, boxed: true },
              ],
            },
          ]),
        ],
        { width: 896, top: 112, bottom: 64, center: true, moreLines: ["1", "1"], extra: { ...glow(0), width: "full" } },
      ),
      row(
        "home-features",
        [
          column("home-features-col", [
            heading("home-features-h2", m("home.featuresTitle"), 2),
            text("home-features-lead", doc(m("home.featuresBody")), { typography: mutedText(16), style: { padding: { top: 0, right: 0, bottom: 32, left: 0 } } }),
            cards(
              "home-feature-cards",
              features.map((feature, i) => ({ id: `home-feature${i + 1}`, icon: icons[i] ?? "sparkles", title: feature.title, text: feature.body })),
              { typography: { text: { align: "left" } } },
            ),
          ]),
        ],
        { center: true },
      ),
      row(
        "home-exclusive",
        [
          column("home-exclusive-text", [
            text("home-exclusive-eyebrow", doc(m("home.exclusiveEyebrow")), { typography: eyebrowText }),
            heading("home-exclusive-h2", m("home.exclusiveTitle"), 2),
            text("home-exclusive-body", doc(m("home.exclusiveBody")), { typography: mutedText(16) }),
          ]),
          column("home-exclusive-points", [
            cards(
              "home-exclusive-cards",
              points.map((point, i) => ({ id: `home-exclusive${i + 1}`, points: [point] })),
              { marker: "none", columns: 1, pointMark: "check", pointColor: LIFE.success },
            ),
          ]),
        ],
        {
          layout: "2",
          top: 80,
          bottom: 80,
          extra: {
            width: "full",
            align: "middle",
            gap: 40,
            background: { type: "color", color: LIFE.surface, opacity: 40 },
            border: { style: "solid", color: LIFE.border, width: { top: 1, right: 0, bottom: 1, left: 0 } },
          },
        },
      ),
      row("home-how", [
        column("home-how-col", [
          heading("home-how-h2", m("home.howTitle"), 2, { typography: { text: { align: "center" } }, style: { padding: { top: 0, right: 0, bottom: 32, left: 0 } } }),
          cards(
            "home-steps",
            steps.map((step, i) => ({ id: `home-step${i + 1}`, title: step.title, text: step.body })),
            { marker: "number", look: "plain" },
          ),
        ]),
      ]),
      row(
        "home-call",
        [
          column(
            "home-call-box",
            [
              heading("home-call-h2", m("home.ctaTitle"), 2),
              text("home-call-body", doc(m("home.ctaBody")), { typography: mutedText(16) }),
              buttons("home-call-actions", { label: m("home.ctaGetStarted"), href: "/plans" }, { label: m("home.ctaComparePlans"), href: "/plans" }),
            ],
            { ...box([72, 24, 72, 24]), ...glow(0, LIFE.surface), typography: { text: { align: "center" } } },
          ),
        ],
        { top: 0 },
      ),
    ],
  };
}

const px = (value: number) => ({ value, unit: "px" as const });
const noPad = { style: { padding: { top: 0, right: 0, bottom: 0, left: 0 } } };

/** A page's hero: Life's badge over the title and its lead, centred on the glow, the whole screen wide. */
function hero(id: string, line: string, title: string, lead: string, options: { size?: number; extra?: Json[] } = {}): Json {
  const { size = 56, extra = [] } = options;
  return row(
    id,
    [
      column(`${id}-badge`, [badge(`${id}-pill`, line)], { inline: true, justify: "center" }),
      column(`${id}-text`, [
        heading(`${id}-h1`, title, 1, { typography: { text: { size: px(size), lineHeight: { value: 1.08, unit: "" } } }, at: { sm: { typography: { text: { size: px(36) } } } } }),
        text(`${id}-lead`, doc(lead), { typography: mutedText(17), style: { padding: { top: 0, right: 96, bottom: 0, left: 96 } }, at: { sm: noPad } }),
        ...extra,
      ]),
    ],
    { width: 768, top: 112, bottom: 40, center: true, moreLines: ["1"], extra: { ...glow(0), width: "full" } },
  );
}

/** A section's small line with its icon, in the accent: the words over a feature's title. */
function eyebrow(id: string, icon: string, line: string): Json {
  return { id, type: "iconList", items: [{ id: `${id}-line`, icon, text: line, href: "" }], iconColor: LIFE.accentText, typography: eyebrowText };
}

/** Points with a dot before each, as Life lists a feature's points. */
function dots(id: string, points: string[]): Json {
  return cards(id, [{ id: `${id}-card`, points }], { marker: "none", columns: 1, look: "plain", pointMark: "dot", typography: { text: { align: "left" } } });
}

const MATRIX = JSON.parse(readFileSync(join(import.meta.dirname, "data", "plans-matrix.json"), "utf8")) as {
  plans: { slug: string; name: string }[];
  features: { key: string; label: string; description: string; category: string }[];
  includes: Record<string, string[]>;
};

/** The comparison's groups, by Life's feature categories, named here in each language (Life writes them out from the key). */
const CATEGORY_NAMES: Record<string, Record<string, string>> = {
  page: { en: "Pages", nb: "Sider", sv: "Sidor" },
  capability: { en: "Capabilities", nb: "Muligheter", sv: "Möjligheter" },
  api: { en: "AI and integrations", nb: "AI og integrasjoner", sv: "AI och integrationer" },
  addon: { en: "Add-ons", nb: "Tillegg", sv: "Tillägg" },
};

/** Free and the plans against every feature, by category: a tick where the plan includes it (Life's `FeatureComparison`). */
function comparison(id: string, w: Words, featureWord: string): Json {
  const order = [...new Set(MATRIX.features.map((feature) => feature.category))];
  const rows: string[][] = [[featureWord, ...MATRIX.plans.map((plan) => plan.name)]];
  const sections: (string | null)[] = [null];
  for (const category of order) {
    MATRIX.features
      .filter((feature) => feature.category === category)
      .forEach((feature, at) => {
        sections.push(at === 0 ? (CATEGORY_NAMES[category]?.[w.lang] ?? category) : null);
        rows.push([feature.label, ...MATRIX.plans.map((plan) => (MATRIX.includes[plan.slug]?.includes(feature.key) ? "{{check}}" : "{{minus}}"))]);
      });
  }
  return { id, type: "table", rows, header: true, rowHeaders: true, sections, mobile: "scroll", iconColor: LIFE.accent, sectionColor: LIFE.muted };
}

type FeatureSection = { eyebrow: string; title: string; body: string; points: string[] };

/** The features page (`/features`): hero; seven features, five beside a picture of the app taking turns, two centred; the comparison. */
export function featuresPage(w: Words): LifePage {
  const m = (key: string) => w.t("marketing", key);
  const sections = w.raw<FeatureSection[]>("marketing", "features.sections");
  const icons = ["calendarDays", "listChecks", "wallet", "dumbbell", "sparkles", "radio", "plug"];
  const tasks = w.raw<string[]>("marketing", "features.illustration.dueTasks");
  const checklist = w.raw<string[]>("marketing", "features.illustration.checklistItems");
  const pictures: Json[][] = [
    [
      { id: "fp-today-title", kind: "title", title: m("features.illustration.today"), aside: "" },
      { id: "fp-today-brief", kind: "briefing", icon: "sparkles", title: m("features.illustration.briefing"), lines: 2, boxed: true },
      { id: "fp-today-due", kind: "checklist", title: m("features.illustration.dueToday"), boxed: true, items: tasks.map((task, i) => ({ id: `fp-today-due${i + 1}`, text: task, done: i === 0 })) },
    ],
    [
      { id: "fp-list-title", kind: "title", title: m("features.illustration.checklistTitle"), aside: "8/12", asideTone: "accent", asidePill: true },
      { id: "fp-list-bar", kind: "progress", value: 66 },
      { id: "fp-list-items", kind: "checklist", title: "", mark: "box", divided: true, items: checklist.map((item, i) => ({ id: `fp-list-item${i + 1}`, text: item, done: i < 2 })) },
    ],
    [
      { id: "fp-cash-title", kind: "title", title: m("features.illustration.cashflowTitle"), aside: m("features.illustration.cashflowOnTrack"), asideTone: "success" },
      { id: "fp-cash-bars", kind: "bars", title: "", aside: "", values: [55, 80, 40, 95, 65, 72], soft: 1, tall: true, captionStart: m("features.illustration.cashflowMonth"), captionEnd: m("features.illustration.cashflowForecast") },
    ],
    [
      { id: "fp-train", kind: "pairs", title: m("features.illustration.trainingTitle"), legendFirst: m("features.illustration.trainingPlanned"), legendSecond: m("features.illustration.trainingDone"), values: [[70, 60], [85, 90], [60, 50], [90, 80]], caption: m("features.illustration.trainingBlock") },
    ],
    [
      { id: "fp-chat", kind: "chat", title: m("features.illustration.assistantTitle"), messages: [{ id: "fp-chat-you", text: m("features.illustration.assistantUser"), mine: true }, { id: "fp-chat-reply", text: m("features.illustration.assistantReply"), mine: false }] },
    ],
  ];
  const sectionRows = sections.map((section, i) => {
    const words = [
      eyebrow(`fs${i + 1}-eyebrow`, icons[i] ?? "sparkles", section.eyebrow),
      heading(`fs${i + 1}-h2`, section.title, 2, { typography: { text: { size: px(32), lineHeight: { value: 1.15, unit: "" } } }, at: { sm: { typography: { text: { size: px(26) } } } } }),
      text(`fs${i + 1}-body`, doc(section.body), { typography: mutedText(16) }),
      dots(`fs${i + 1}-points`, section.points),
    ];
    const picture = pictures[i];
    if (!picture) return row(`fs${i + 1}`, [column(`fs${i + 1}-text`, words)], { width: 672, top: 48, bottom: 48, center: true });
    const art = column(`fs${i + 1}-art`, [{ id: `fs${i + 1}-picture`, type: "appPreview", frame: "card", bar: "", sideTitle: "", side: [], alt: section.title, parts: picture }]);
    const copy = column(`fs${i + 1}-text`, words);
    const turned = i % 2 === 1;
    return row(`fs${i + 1}`, turned ? [art, copy] : [copy, art], {
      layout: "2",
      top: 48,
      bottom: 48,
      extra: { align: "middle", gap: 48, ...(turned ? { at: { sm: { reverse: true, style: { padding: { top: 32, right: 20, bottom: 32, left: 20 } } } } } : {}) },
    });
  });
  return {
    slug: "features",
    title: m("features.metaTitle"),
    seo: { title: m("features.metaTitle"), description: m("features.metaDescription") },
    rows: [
      hero("features-hero", m("features.badge"), m("features.heroTitle"), m("features.heroBody")),
      ...sectionRows,
      row(
        "features-compare",
        [
          column("features-compare-col", [
            heading("features-compare-h2", m("features.compareTitle"), 2, { typography: { text: { align: "center" } } }),
            text("features-compare-lead", doc(m("features.compareBody")), { typography: { text: { color: LIFE.muted, size: px(16), align: "center" } }, style: { padding: { top: 0, right: 0, bottom: 24, left: 0 } } }),
            comparison("features-compare-table", w, m("features.comparisonFeature")),
            { id: "features-compare-cta", type: "button", label: m("features.compareCta"), href: "/plans", size: "lg", shape: "pill", align: "center" },
          ]),
        ],
        { width: 896 },
      ),
    ],
  };
}

/** Questions with their answers in a box each, the first open; their words are the page's FAQPage data, as on Life's page. */
function questions(id: string, items: { q: string; a: string }[]): Json {
  return {
    id,
    type: "faq",
    look: "boxed",
    openFirst: true,
    items: items.map((item, i) => ({ id: `${id}-q${i + 1}`, title: item.q, body: doc(item.a) })),
  };
}

/** The plans page (`/plans`): the hero, the store's own Plans component, the line to every feature, the app stores' note and the questions. */
export function plansPage(w: Words, facts: StoreFacts): LifePage {
  const m = (key: string) => w.t("marketing", key);
  const plans = {
    switcher: true,
    decimals: "hide_whole",
    buttonLabel: "",
    buttonHref: "",
    ...(facts.plans ?? {}),
    ...(facts.plansCategory ? { categoryId: facts.plansCategory } : {}),
    id: "plans-table",
    type: "plans",
  };
  return {
    slug: "plans",
    title: m("pricing.heroTitle"),
    seo: { title: m("pricing.metaTitle"), description: m("pricing.metaDescription") },
    rows: [
      row(
        "plans-hero",
        [
          column("plans-hero-text", [
            heading("plans-h1", m("pricing.heroTitle"), 1, { typography: { text: { size: px(52) } } }, ),
            text("plans-lead", doc(m("pricing.heroBody")), { typography: mutedText(17) }),
          ]),
        ],
        { width: 768, top: 96, bottom: 24, center: true },
      ),
      row(
        "plans-cards",
        [
          column("plans-cards-col", [
            plans,
            text("plans-details", doc([`${m("pricing.detailsPrefix")} `, { text: m("pricing.detailsLink"), href: "/features" }, ` ${m("pricing.detailsSuffix")}`]), { typography: { text: { color: LIFE.muted, size: px(14), align: "center" } }, style: { padding: { top: 40, right: 0, bottom: 0, left: 0 } } }),
            text("plans-stores", doc(m("pricing.appStoreNote")), { typography: { text: { color: LIFE.muted, size: px(13), align: "center" } } }),
          ]),
        ],
        { top: 24, bottom: 48 },
      ),
      row("plans-questions", [column("plans-questions-col", [heading("plans-questions-h2", m("faq.title"), 2, { typography: { text: { align: "center" } }, style: { padding: { top: 0, right: 0, bottom: 24, left: 0 } } }), questions("plans-faq", w.raw<{ q: string; a: string }[]>("marketing", "faq.items"))])], { width: 768, top: 48 }),
    ],
  };
}

/** Lines with a tick each, in Life's green. */
function ticks(id: string, lines: string[], color: string = LIFE.success): Json {
  return { id, type: "iconList", items: lines.map((line, i) => ({ id: `${id}-${i + 1}`, icon: "check", text: line, href: "" })), iconColor: color, gap: 12 };
}

const sectionTitle = (id: string, words: string) => heading(id, words, 2, { typography: { text: { size: px(22) } }, style: { padding: { top: 48, right: 0, bottom: 0, left: 0 } } });

/** Running Analyzer (`/running-analyzer`): what it is, how it works, how accurate each measure is, its principles, and the way to the plans. */
export function runningAnalyzerPage(w: Words): LifePage {
  const m = (key: string) => w.t("marketing", key);
  const steps = ["setup", "analyze", "coach", "report"];
  const stepIcons = ["video", "eye", "footprints", "shieldCheck"];
  const tiers: [string, string][] = [["excellent", LIFE.success], ["good", LIFE.accent], ["situational", LIFE.muted]];
  type TierRow = { metric: string; how: string; note: string };
  return {
    slug: "running-analyzer",
    title: m("runningAnalyzer.title"),
    seo: { title: m("runningAnalyzer.metaTitle"), description: m("runningAnalyzer.metaDescription") },
    rows: [
      row(
        "ra",
        [
          column("ra-col", [
            text("ra-eyebrow", doc(m("runningAnalyzer.eyebrow")), { typography: eyebrowText }),
            heading("ra-h1", m("runningAnalyzer.title"), 1, { typography: { text: { size: px(40) } } }),
            text("ra-lead", doc(m("runningAnalyzer.lead")), { typography: mutedText(16) }),
            sectionTitle("ra-how-h2", m("runningAnalyzer.howTitle")),
            cards(
              "ra-how",
              steps.map((step, i) => ({ id: `ra-how-${step}`, icon: stepIcons[i], title: m(`runningAnalyzer.how.${step}.title`), text: m(`runningAnalyzer.how.${step}.body`) })),
              { columns: 2 },
            ),
            sectionTitle("ra-tiers-h2", m("runningAnalyzer.tiersTitle")),
            text("ra-tiers-lead", doc(m("runningAnalyzer.tiersLead")), { typography: mutedText(14) }),
            ...tiers.flatMap(([tier, color]) => [
              heading(`ra-${tier}-h3`, m(`runningAnalyzer.tier.${tier}.title`), 3, { typography: { text: { size: px(15), color } }, style: { padding: { top: 24, right: 0, bottom: 0, left: 0 } } }),
              text(`ra-${tier}-body`, doc(m(`runningAnalyzer.tier.${tier}.body`)), { typography: mutedText(14) }),
              {
                id: `ra-${tier}-table`,
                type: "table",
                header: true,
                mobile: "scroll",
                headerColor: LIFE.muted,
                rows: [[m("runningAnalyzer.colMetric"), m("runningAnalyzer.colHow"), m("runningAnalyzer.colNote")], ...w.raw<TierRow[]>("marketing", `runningAnalyzer.tier.${tier}.rows`).map((r) => [r.metric, r.how, r.note])],
                border: { style: "solid", color: LIFE.border, width: { top: 1, right: 1, bottom: 1, left: 1 } },
                radius: 9,
              },
            ]),
            sectionTitle("ra-principles-h2", m("runningAnalyzer.principlesTitle")),
            ticks("ra-principles", w.raw<string[]>("marketing", "runningAnalyzer.principles")),
          ]),
        ],
        { width: 896, top: 64, bottom: 32 },
      ),
      row(
        "ra-call",
        [
          column(
            "ra-call-box",
            [
              text("ra-call-lead", doc(m("runningAnalyzer.ctaLead")), { typography: { text: { size: px(15), weight: 500 } } }),
              { id: "ra-call-button", type: "button", label: m("runningAnalyzer.cta"), href: "/plans", shape: "pill", align: "center" },
            ],
            { ...box(), typography: { text: { align: "center" } } },
          ),
        ],
        { width: 896, top: 24 },
      ),
    ],
  };
}

const INTEGRATIONS = JSON.parse(readFileSync(join(import.meta.dirname, "data", "integrations.json"), "utf8")) as {
  categories: Record<string, string>;
  integrations: { name: string; category: string; blurb: string; capabilities: string[]; brandColor: string; monogram: string; mobile?: boolean }[];
};

/** Integrations (`/integrations`): the hero, every integration as a card with its letters on its colour, chips by group, and the call. */
export function integrationsPage(w: Words): LifePage {
  const m = (key: string) => w.t("marketing", key);
  return {
    slug: "integrations",
    title: m("integrations.heroTitle"),
    seo: { title: m("integrations.metaTitle"), description: m("integrations.metaDescription") },
    rows: [
      hero("int-hero", m("integrations.badge"), m("integrations.heroTitle"), m("integrations.heroBody"), { size: 52 }),
      row("int-list", [
        column("int-list-col", [
          cards(
            "int-cards",
            INTEGRATIONS.integrations.map((it, i) => ({
              id: `int-${i + 1}`,
              letters: it.monogram.slice(0, 3),
              color: it.brandColor.toLowerCase(),
              eyebrow: INTEGRATIONS.categories[it.category] ?? it.category,
              title: it.name,
              text: it.blurb,
              points: it.capabilities,
              group: INTEGRATIONS.categories[it.category] ?? it.category,
              ...(it.mobile ? { badge: m("integrations.mobileApp"), badgeTone: "neutral" } : {}),
            })),
            { marker: "letter", filters: true, allLabel: m("integrations.filterAll"), pointColor: LIFE.success },
          ),
        ]),
      ], { top: 24, bottom: 64 }),
      row(
        "int-call",
        [
          column(
            "int-call-box",
            [
              heading("int-call-h2", m("integrations.ctaTitle"), 2),
              text("int-call-body", doc(m("integrations.ctaBody")), { typography: mutedText(16) }),
              buttons("int-call-actions", { label: m("integrations.ctaGetStarted"), href: "/plans" }, { label: m("integrations.ctaExploreFeatures"), href: "/features" }),
            ],
            { ...box([56, 24, 56, 24]), ...glow(0, LIFE.surface), typography: { text: { align: "center" } } },
          ),
        ],
        { top: 0 },
      ),
    ],
  };
}

type Pain = { title: string; body: string };
type Solution = { eyebrow: string; title: string; body: string; points: string[] };
type DayStep = { time: string; title: string; body: string };
type RoadmapItem = { label: string; status: "live" | "roadmap" | "ondemand" };
const STATUS_TONE: Record<RoadmapItem["status"], string> = { live: "success", roadmap: "accent", ondemand: "warning" };

/** A band in Life's surface, the whole screen wide: its first row draws the line above, its last the line below. */
const band = (first: boolean, last: boolean) => ({
  width: "full",
  background: { type: "color", color: LIFE.surface, opacity: 40 },
  ...(first || last ? { border: { style: "solid", color: LIFE.border, width: { top: first ? 1 : 0, right: 0, bottom: last ? 1 : 0, left: 0 } } } : {}),
});

/** A section's title and its line, centred. */
function sectionHead(id: string, title: string, lead: string, size = 36): Json[] {
  return [
    heading(`${id}-h2`, title, 2, { typography: { text: { size: px(size), align: "center" } }, at: { sm: { typography: { text: { size: px(28) } } } } }),
    text(`${id}-lead`, doc(lead), { typography: { text: { color: LIFE.muted, size: px(16), align: "center" } }, style: { padding: { top: 0, right: 0, bottom: 32, left: 0 } } }),
  ];
}

/** A use case's picture beside a solution: Life's rotation of a list, bars, a chat, rings and a calendar, or the entrepreneur's own. */
function solutionPicture(id: string, i: number, solution: Solution, w: Words, key: string): Json[] {
  if (key === "entrepreneur") {
    const u = (k: string) => w.t("useCases", `entrepreneur.${k}`);
    const tasks = w.raw<string[]>("useCases", "entrepreneur.heroMockupTasks");
    const steps = w.raw<DayStep[]>("useCases", "entrepreneur.daySteps");
    const solutions = w.raw<Solution[]>("useCases", "entrepreneur.solutions");
    const pictures: Json[][] = [
      [{ id: `${id}-brief`, kind: "briefing", icon: "sparkles", title: u("heroMockupTitle"), lines: 3, dots: true }],
      [{ id: `${id}-board`, kind: "kanban", columns: [[0, 1], [1], [2]].map((cards, c) => ({ id: `${id}-col${c + 1}`, cards: cards.map((t, r) => ({ id: `${id}-col${c + 1}-${r + 1}`, text: tasks[t] })) })) }],
      [
        { id: `${id}-title`, kind: "title", title: u("heroMockupRunway"), aside: "+18%", asideTone: "success" },
        { id: `${id}-bars`, kind: "bars", title: "", aside: "", values: [50, 64, 58, 76, 70, 88, 82], soft: 2, tall: true, captionStart: "", captionEnd: "" },
      ],
      [{ id: `${id}-rows`, kind: "rows", icon: "briefcase", title: u("heroMockupInvoices"), items: tasks.map((t, r) => ({ id: `${id}-row${r + 1}`, text: t, tone: ["success", "warning", "neutral"][r % 3] })) }],
      [{ id: `${id}-chat`, kind: "chat", title: solutions[4]?.eyebrow ?? "", messages: [{ id: `${id}-you`, text: steps[2]?.body ?? "", mine: true }, { id: `${id}-reply`, text: `✓ ${u("statusLive")}`, mine: false }] }],
      [{ id: `${id}-pairs`, kind: "pairs", title: u("statusLive"), legendFirst: "", legendSecond: "", values: [[70, 60], [85, 90], [60, 50], [90, 80]], caption: "" }],
    ];
    return pictures[i] ?? [];
  }
  switch (i % 6) {
    case 1:
      return [{ id: `${id}-bars`, kind: "bars", title: "", aside: "", values: [50, 64, 58, 76, 70, 88, 82], soft: 2, tall: true, captionStart: "", captionEnd: "" }];
    case 2:
      return [{ id: `${id}-chat`, kind: "chat", title: solution.eyebrow, messages: [{ id: `${id}-you`, text: solution.points[0] ?? "", mine: true }, { id: `${id}-reply`, text: "✓", mine: false }] }];
    case 3:
      return [{ id: `${id}-rings`, kind: "rings", items: [72, 88, 54].map((value, r) => ({ id: `${id}-ring${r + 1}`, text: solution.points[r] ?? "", value })) }];
    case 4:
      return [{ id: `${id}-days`, kind: "heatmap", weeks: 4, on: [2, 5, 9, 12, 13, 18, 22, 25] }];
    default:
      return [{ id: `${id}-list`, kind: "checklist", title: solution.eyebrow, mark: "circle", divided: true, items: solution.points.map((point, r) => ({ id: `${id}-item${r + 1}`, text: point, done: r === 0 })) }];
  }
}

const USE_CASES = [
  { key: "entrepreneur", slug: "the-entrepreneur", icon: "rocket" },
  { key: "family", slug: "the-family", icon: "users" },
  { key: "community", slug: "the-community", icon: "usersRound" },
  { key: "organiser", slug: "the-organiser", icon: "clipboardList" },
  { key: "biohacker", slug: "the-biohacker", icon: "activity" },
] as const;

/** A use case (`/use-cases/{slug}`), as Life's shared layout draws it: hero beside the app, the pains, the solutions, a day, the roadmap, a quote, the call. */
function useCasePage(w: Words, key: string, slug: string): LifePage {
  const u = (k: string) => w.t("useCases", `${key}.${k}`);
  const raw = <T,>(k: string) => w.raw<T>("useCases", `${key}.${k}`);
  const items = key === "entrepreneur" ? raw<string[]>("heroMockupTasks") : raw<string[]>("heroMockupItems");
  const metric = key === "entrepreneur" ? u("heroMockupRunway") : u("heroMockupMetric");
  const status = (s: RoadmapItem["status"]) =>
    key === "entrepreneur" ? u(s === "live" ? "statusLive" : s === "roadmap" ? "statusRoadmap" : "statusOnDemand") : w.t("useCases", `status.${s}`);
  const solutions = raw<Solution[]>("solutions");
  const id = `uc-${key}`;
  return {
    slug,
    title: u("heroTitle"),
    seo: { title: u("metaTitle"), description: u("metaDescription") },
    rows: [
      row(
        `${id}-hero`,
        [
          column(`${id}-hero-text`, [
            text(`${id}-eyebrow`, doc({ text: u("eyebrow"), href: "/use-cases" }), { typography: eyebrowText }),
            heading(`${id}-h1`, u("heroTitle"), 1, { typography: { text: { size: px(48), lineHeight: { value: 1.08, unit: "" } } }, at: { sm: { typography: { text: { size: px(34) } } } } }),
            text(`${id}-lead`, doc(u("heroBody")), { typography: mutedText(17) }),
            buttons(`${id}-actions`, { label: u("heroPrimary"), href: "/plans" }, { label: u("heroSecondary"), href: "/plans" }, "left"),
            text(`${id}-note`, doc(u("heroNote")), { typography: mutedText(13) }),
          ]),
          column(`${id}-hero-app`, [
            {
              id: `${id}-app`,
              type: "appPreview",
              frame: "window",
              bar: u("heroMockupTitle"),
              barTitle: true,
              sideTitle: "",
              side: [],
              alt: u("heroTitle"),
              parts: [
                { id: `${id}-app-brief`, kind: "briefing", icon: "sparkles", title: u("heroMockupBriefing"), lines: 0, boxed: true },
                { id: `${id}-app-items`, kind: "checklist", title: "", mark: "tick", half: true, boxed: true, items: items.map((item, i) => ({ id: `${id}-app-item${i + 1}`, text: item, done: i === 0 })) },
                { id: `${id}-app-metric`, kind: "bars", ...(key === "entrepreneur" ? { icon: "wallet" } : {}), title: metric, aside: "", values: [58, 72, 64, 84, 70, 92], soft: 0, captionStart: "", captionEnd: "", half: true, boxed: true },
              ],
            },
          ]),
        ],
        { layout: "2", top: 96, bottom: 64, extra: { ...glow(0), width: "full", align: "middle", gap: 48 } },
      ),
      row(`${id}-pains`, [column(`${id}-pains-col`, [...sectionHead(`${id}-pains`, u("painTitle"), u("painBody")), cards(`${id}-pain-cards`, raw<Pain[]>("pains").map((pain, i) => ({ id: `${id}-pain${i + 1}`, title: pain.title, text: pain.body })), { marker: "none", columns: 2 })])], { top: 64, bottom: 64 }),
      row(`${id}-solutions-head`, [column(`${id}-solutions-head-col`, sectionHead(`${id}-solutions`, u("solutionTitle"), u("solutionBody")))], { top: 80, bottom: 0, extra: band(true, false) }),
      ...solutions.map((solution, i) => {
        const sid = `${id}-s${i + 1}`;
        const copy = column(`${sid}-text`, [
          text(`${sid}-eyebrow`, doc(solution.eyebrow), { typography: eyebrowText }),
          heading(`${sid}-h3`, solution.title, 3, { typography: { text: { size: px(30), lineHeight: { value: 1.15, unit: "" } } }, at: { sm: { typography: { text: { size: px(24) } } } } }),
          text(`${sid}-body`, doc(solution.body), { typography: mutedText(16) }),
          ticks(`${sid}-points`, solution.points),
        ]);
        const art = column(`${sid}-art`, [{ id: `${sid}-picture`, type: "appPreview", frame: "card", bar: "", sideTitle: "", side: [], alt: solution.title, parts: solutionPicture(sid, i, solution, w, key) }]);
        const turned = i % 2 === 1;
        return row(`${sid}`, turned ? [art, copy] : [copy, art], {
          layout: "2",
          top: 40,
          bottom: i === solutions.length - 1 ? 80 : 40,
          extra: { ...band(false, i === solutions.length - 1), align: "middle", gap: 48, ...(turned ? { at: { sm: { reverse: true, style: { padding: { top: 26, right: 20, bottom: 26, left: 20 } } } } } : {}) },
        });
      }),
      row(`${id}-day`, [column(`${id}-day-col`, [...sectionHead(`${id}-day`, u("dayTitle"), u("dayBody")), { id: `${id}-timeline`, type: "timeline", markerColor: LIFE.accent, items: raw<DayStep[]>("daySteps").map((step, i) => ({ id: `${id}-step${i + 1}`, date: step.time, title: step.title, text: step.body })) }])], { width: 768 }),
      row(
        `${id}-roadmap`,
        [column(`${id}-roadmap-col`, [...sectionHead(`${id}-roadmap`, u("roadmapTitle"), u("roadmapBody"), 34), cards(`${id}-roadmap-cards`, raw<RoadmapItem[]>("roadmapItems").map((item, i) => ({ id: `${id}-road${i + 1}`, title: item.label, badge: status(item.status), badgeTone: STATUS_TONE[item.status] })), { marker: "none", columns: 2 })])],
        { width: 896, top: 80, bottom: 80, extra: band(true, true) },
      ),
      row(
        `${id}-quote`,
        [
          column(`${id}-quote-col`, [
            text(`${id}-quote-words`, doc(u("quote")), { typography: { text: { size: px(28), weight: 500, lineHeight: { value: 1.4, unit: "" } } }, at: { sm: { typography: { text: { size: px(22) } } } } }),
            text(`${id}-quote-who`, doc(u("quoteAuthor")), { typography: mutedText(14) }),
          ]),
        ],
        { width: 768, center: true },
      ),
      row(
        `${id}-call`,
        [
          column(
            `${id}-call-box`,
            [
              heading(`${id}-call-h2`, u("ctaTitle"), 2, { typography: { text: { size: px(40) } }, at: { sm: { typography: { text: { size: px(30) } } } } }),
              text(`${id}-call-body`, doc(u("ctaBody")), { typography: mutedText(16) }),
              buttons(`${id}-call-actions`, { label: u("ctaPrimary"), href: "/plans" }, { label: u("ctaSecondary"), href: "/plans" }),
              text(`${id}-call-note`, doc(u("ctaNote")), { typography: mutedText(13) }),
            ],
            { ...box([72, 24, 72, 24]), ...glow(0, LIFE.surface), typography: { text: { align: "center" } } },
          ),
        ],
        { top: 0 },
      ),
    ],
  };
}

/** The use cases (`/use-cases`): the hero, a card for each with its link, and the call. */
export function useCasesPage(w: Words): LifePage {
  const u = (k: string) => w.t("useCases", `index.${k}`);
  const list = w.raw<{ name: string; tagline: string; who: string }[]>("useCases", "index.cards");
  return {
    slug: "use-cases",
    title: u("heroTitle"),
    seo: { title: u("metaTitle"), description: u("metaDescription") },
    rows: [
      hero("ucs-hero", u("badge"), u("heroTitle"), u("heroBody")),
      row("ucs-list", [
        column("ucs-list-col", [
          cards(
            "ucs-cards",
            list.map((card, i) => {
              const use = USE_CASES[i];
              return { id: `ucs-${i + 1}`, icon: use?.icon ?? "sparkles", title: card.name, text: `${card.tagline}\n\n${card.who}`, ...(use ? { linkLabel: u("explore"), href: `/use-cases/${use.slug}` } : { badge: u("comingSoon") }) };
            }),
          ),
        ]),
      ], { top: 24, bottom: 64 }),
      row(
        "ucs-call",
        [
          column(
            "ucs-call-box",
            [
              heading("ucs-call-h2", u("ctaTitle"), 2),
              text("ucs-call-body", doc(u("ctaBody")), { typography: mutedText(16) }),
              buttons("ucs-call-actions", { label: u("ctaPrimary"), href: "/plans" }, { label: u("ctaSecondary"), href: "/plans" }),
            ],
            { ...box([56, 24, 56, 24]), ...glow(0, LIFE.surface), typography: { text: { align: "center" } } },
          ),
        ],
        { top: 0 },
      ),
    ],
  };
}

const ABOUT = JSON.parse(readFileSync(join(import.meta.dirname, "data", "about.json"), "utf8")) as {
  title: string;
  story: string[];
  team: { name: string; role: string; bio: string; picture: { url: string; width: number; height: number } | null; x: string | null }[];
};

/** About (`/about`): Life's story and its team, each with a round picture, role, words and X. Life writes it in English only, and so does this. */
export function aboutPage(): LifePage {
  return {
    slug: "about",
    title: ABOUT.title,
    seo: { title: ABOUT.title, description: `Who's behind ${APP_TITLE}: the team and the agents that run it.` },
    rows: [
      row("about-story", [column("about-story-col", [heading("about-h1", ABOUT.title, 1, { typography: { text: { size: px(36) } } }), text("about-story-text", doc(...ABOUT.story), { typography: mutedText(16) })])], { width: 768, top: 64, bottom: 32 }),
      row("about-team", [
        column("about-team-col", [
          heading("about-team-h2", "Meet the team", 2, { typography: { text: { size: px(24) } }, style: { padding: { top: 0, right: 0, bottom: 24, left: 0 } } }),
          cards(
            "about-team-cards",
            ABOUT.team.map((person, i) => ({
              id: `about-person${i + 1}`,
              title: person.name,
              eyebrow: person.role,
              text: person.bio,
              ...(person.x ? { href: person.x, linkLabel: "X" } : {}),
              ...(person.picture ? { picture: { ...person.picture, alt: person.name } } : { letters: person.name.slice(0, 1) }),
            })),
            { marker: "picture", look: "plain", centred: true, typography: { meta: { color: LIFE.muted, size: px(13), transform: "none", letterSpacing: px(0), weight: 400 } } },
          ),
        ]),
      ], { width: 960, top: 32 }),
    ],
  };
}

type LegalVersion = { title: string; updated: string; html: string };
const LEGAL = JSON.parse(readFileSync(join(import.meta.dirname, "data", "legal.json"), "utf8")) as Record<string, Record<string, LegalVersion> | string>;
const LEGAL_PAGES = ["privacy", "terms", "support", "accessibility", "account-deletion"] as const;

/** A legal page (`/privacy`, `/terms`, `/support`, `/accessibility`, `/account-deletion`): its title, when it was updated, and the document. */
function legalPage(w: Words, slug: (typeof LEGAL_PAGES)[number]): LifePage {
  const versions = LEGAL[slug];
  if (!versions || typeof versions === "string") throw new Error(`No ${slug} in data/legal.json`);
  const version = versions[w.lang] ?? versions.en;
  return {
    slug,
    title: version.title,
    seo: { title: `${version.title} · ${APP_TITLE}`, description: "" },
    rows: [
      row(`legal-${slug}`, [
        column(`legal-${slug}-col`, [
          heading(`legal-${slug}-h1`, version.title, 1, { typography: { text: { size: px(28) } } }),
          text(`legal-${slug}-updated`, doc(version.updated), { typography: mutedText(14) }),
          text(`legal-${slug}-text`, htmlToRichText(version.html).doc, { typography: { text: { size: px(15) } } }),
        ]),
      ], { width: 672, top: 56, bottom: 72 }),
    ],
  };
}

/** Every page the importer builds, by the name `--only` takes. */
export const PAGES: Record<string, (w: Words, facts: StoreFacts) => LifePage> = {
  front: frontPage,
  features: featuresPage,
  plans: plansPage,
  analyzer: runningAnalyzerPage,
  integrations: integrationsPage,
  about: aboutPage,
  ...Object.fromEntries(LEGAL_PAGES.map((slug) => [slug, (w: Words) => legalPage(w, slug)])),
  "use-cases": useCasesPage,
  ...Object.fromEntries(USE_CASES.map((use) => [use.slug, (w: Words) => useCasePage(w, use.key, `use-cases/${use.slug}`)])),
};

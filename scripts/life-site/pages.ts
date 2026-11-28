/**
 * Kaizena Life's pages (D916, `docs/life-site-move.md`), each built from Life's own words in one language. The ids are fixed, so a page
 * built in English and in Norwegian differ only in their words, and a second import updates the same parts.
 */
import { APP_SIGN_IN, APP_TITLE, LIFE, badge, box, buttons, cards, column, doc, eyebrowText, glow, heading, mutedText, row, text, type Json, type Words } from "./kit";

export type LifePage = { slug: string; title: string; seo: { title: string; description: string }; rows: Json[] };

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

/** Every page the importer builds, by the name `--only` takes. */
export const PAGES: Record<string, (w: Words) => LifePage> = {
  front: frontPage,
};

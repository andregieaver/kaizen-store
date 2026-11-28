/**
 * What Kaizena Life's pages sit in (D916, D917, `docs/life-site-move.md`): its theme as a look of the store's theme library, its main and
 * footer menus, and its header and footer as Life draws them (`components/marketing/marketing-header.tsx` and `marketing-footer.tsx` in
 * lifesaver-app), built from the builder's own parts and Life's words in each language. The importer makes them over the Admin API
 * (`POST /themes`, `POST /menus`, `POST /pages` with `type`); nothing shows on the site until the owner publishes the header and footer
 * and makes the look live.
 */
import { parseStoreTheme, storeThemeInput } from "@/lib/theme-schema";

import { APP_SIGN_IN, APP_TITLE, LANGS, LIFE, column, doc, text, type Json, type Lang, type Words } from "./kit";
import type { LifePage } from "./pages";

export const LOOK_TITLE = "Kaizena Life";
export const HEADER_SLUG = "life-header";
export const FOOTER_SLUG = "life-footer";
export const MENUS = { main: "Kaizena Life main", footer: "Kaizena Life footer" } as const;

/**
 * Life's theme as Design settings keep it (step 3 of the plan): always dark, Life's palette (hex only, so Life's translucent text and lines
 * are given as they look on black), Geist for headings and text, bold headings, filled pill buttons, cards medium, fields small, 1152 px.
 */
export function lifeTheme(): Json {
  const base = parseStoreTheme(null);
  return storeThemeInput.parse({
    base: "minimal",
    savedId: null,
    settings: {
      ...base.settings,
      mode: "dark",
      light: { background: "#f4f5f8", surface: "#ffffff", text: "#0b0d12", muted: "#59595f", border: "#ebecf0", accent: "#0068da", accentText: "#ffffff" },
      dark: { background: LIFE.black, surface: LIFE.surface, text: "#ffffff", muted: LIFE.muted, border: LIFE.border, accent: LIFE.accent, accentText: "#ffffff" },
      fonts: { heading: "Geist", body: "Geist" },
      headings: { weight: "bold", case: "normal" },
      buttons: { style: "filled", corners: "pill" },
      corners: { cards: "medium", fields: "small" },
      layout: { ...base.settings.layout, width: "normal", maxWidth: 1152, headerAlign: "left", headerBackground: "page" },
    },
  }) as Json;
}

type Link = { kind: string; slug?: string; url?: string };
/** A menu's link: its words in each of the store's languages (English under the store's own locale for it), where it goes. */
const item = (words: Record<Lang, Words>, locales: Record<Lang, string>, key: string, link: Link): Json => ({
  label: Object.fromEntries(LANGS.map((lang) => [locales[lang], words[lang].t("marketing", key)])),
  link,
  depth: 0,
});
const page = (slug: string): Link => ({ kind: "page", slug });

/** Life's two menus, as the menu editor saves them: the header's and the footer's (its cookie settings are the footer's own part). */
export function lifeMenus(words: Record<Lang, Words>, locales: Record<Lang, string>): { name: string; items: Json[] }[] {
  const at = (key: string, link: Link) => item(words, locales, key, link);
  const shared = [at("nav.features", page("features")), at("nav.useCases", page("use-cases")), at("nav.integrations", page("integrations")), at("nav.pricing", page("plans"))];
  return [
    { name: MENUS.main, items: [...shared, at("nav.blog", { kind: "blog" }), at("nav.about", page("about"))] },
    {
      name: MENUS.footer,
      items: [
        ...shared,
        at("nav.signIn", { kind: "url", url: APP_SIGN_IN }),
        at("nav.privacy", page("privacy")),
        at("nav.terms", page("terms")),
        at("nav.support", page("support")),
        at("nav.accessibility", page("accessibility")),
      ],
    },
  ];
}

const px = (value: number) => ({ value, unit: "px" as const });
const sides = (vertical: number, horizontal: number) => ({ padding: { top: vertical, right: horizontal, bottom: vertical, left: horizontal } });
const line = (edge: "top" | "bottom") => ({ border: { style: "solid", color: LIFE.border, width: { top: 0, right: 0, bottom: 0, left: 0, [edge]: 1 } } });
const PHONES_HIDDEN = { visibility: { hideAt: ["sm"] } };
const part = (id: string, name: string, extra: Json = {}): Json => ({ id, type: "site", part: name, ...extra });
const muted = (size: number, weight?: number) => ({ typography: { text: { color: LIFE.muted, size: px(size), ...(weight ? { weight } : {}) } } });

/**
 * Life's header: its logo and name, the main menu in its muted 14 px, the language picker, Sign in to the app and Get started, on one line
 * 64 px high over a line; on phones the menu button opens the menu and the picker stays.
 */
export function lifeHeader(w: Words, menuId: string): LifePage {
  const m = (key: string) => w.t("marketing", key);
  return {
    slug: HEADER_SLUG,
    title: `${APP_TITLE} header`,
    seo: { title: "", description: "" },
    rows: [
      {
        id: "life-header-row",
        type: "row",
        width: "full",
        layout: "fit-sides",
        stack: false,
        align: "middle",
        contentMax: 1152,
        style: sides(12, 20),
        ...line("bottom"),
        at: { sm: { gap: 8 } },
        columns: [
          column("life-header-brand", [part("life-header-menu-button", "menuButton"), part("life-header-logo", "logo", { height: 32 })], { inline: true }),
          column("life-header-nav", [{ id: "life-header-menu", type: "menu", menuId, align: "right", ...PHONES_HIDDEN, ...muted(14, 500) }]),
          column(
            "life-header-tools",
            [
              part("life-header-languages", "languages", { switcher: "dropdown", langText: "code", ...muted(14, 500) }),
              {
                id: "life-header-sign-in",
                type: "button",
                label: m("nav.signIn"),
                href: APP_SIGN_IN,
                variant: "text",
                size: "sm",
                ...PHONES_HIDDEN,
                typography: { text: { color: LIFE.muted, size: px(14), weight: 500, decoration: "none" } },
              },
              { id: "life-header-start", type: "button", label: m("nav.getStarted"), href: "/plans", variant: "filled", size: "sm", shape: "pill", ...PHONES_HIDDEN },
            ],
            { inline: true, justify: "end" },
          ),
        ],
      },
    ],
  };
}

/**
 * Life's footer: its name and line, the footer menu with the cookie settings beside it, and the year's line under a line; with what the law
 * asks of a store's footer that Life's lacks (who runs the site, the withdrawal link), in the same small muted words.
 */
export function lifeFooter(w: Words, menuId: string): LifePage {
  const m = (key: string) => w.t("marketing", key);
  return {
    slug: FOOTER_SLUG,
    title: `${APP_TITLE} footer`,
    seo: { title: "", description: "" },
    rows: [
      {
        id: "life-footer-row",
        type: "row",
        width: "full",
        background: { type: "color", color: LIFE.black },
        layout: "left-sidebar",
        align: "middle",
        contentMax: 1152,
        style: sides(40, 20),
        ...line("top"),
        columns: [
          column("life-footer-about", [
            text("life-footer-name", doc({ text: APP_TITLE, bold: true }), { typography: { text: { size: px(15) } } }),
            text("life-footer-tagline", doc(m("footer.tagline")), muted(13)),
            part("life-footer-business", "business", muted(12)),
          ]),
          column(
            "life-footer-links",
            [
              { id: "life-footer-menu", type: "menu", menuId, ...muted(13) },
              part("life-footer-cookies", "cookies", muted(13)),
              part("life-footer-withdrawal", "withdrawal", muted(13)),
            ],
            { inline: true, justify: "end" },
          ),
        ],
      },
      {
        id: "life-footer-rights",
        type: "row",
        width: "full",
        background: { type: "color", color: LIFE.black },
        layout: "1",
        contentMax: 1152,
        style: sides(16, 20),
        ...line("top"),
        typography: { text: { align: "center" } },
        columns: [column("life-footer-rights-col", [text("life-footer-year", doc(`© ${new Date().getFullYear()} ${APP_TITLE}. ${m("footer.rights")}`), muted(12))])],
      },
    ],
  };
}

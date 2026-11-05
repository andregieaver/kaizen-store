// The *Try the builder* page of kaizenaflow.com (D457 S4, docs/builder-sandbox.md 4.9), built from the site's recipes (docs/site-design.md 6)
// and checked as the editor's save checks it: pageInput, then the page checker with the platform's theme and text styles, and the claims
// filter over its words. Writes `try-the-page-builder.page.json` and `.check.json` to the system's temporary folder (`kaizena-site-pages`),
// to be saved as a draft for the owner to publish (docs/site-design.md 9). Each run makes new part ids. Every claim is built: the sandbox's
// own file says what (docs/builder-sandbox.md 8.1 to 8.4).
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { findClaims } from "@/lib/claims";
import { inlinePlain } from "@/lib/inline-text";
import { blockingIssues, pageIssues, themeSetsOf } from "@/lib/page-a11y";
import { pageInput, pageSlugFromTitle, pageSlugProblem } from "@/lib/page-content";
import { textStylesCss } from "@/lib/text-styles";
import { parseStoreTheme } from "@/lib/theme";

const id = () => randomUUID();
const SAND = "#908064";
const ICON = "#3a4293";
const TEXT = "#171717";

const TURN_A = { type: "gradient", style: "shift", flow: "still", colors: [SAND, "#ededed"] };
const TURN_B = { type: "gradient", style: "shift", flow: "still", angle: 240, colors: [SAND, "#ffffff"] };
const HERO_BG = { type: "gradient", style: "shift", flow: "still", angle: 215, colors: [SAND, "#ffffff"], opacity: 80 };
const pad = (top: number, side: number, bottom: number) => ({ padding: { top, left: side, right: side, bottom } });
const margin = (top: number, left: number, right: number, bottom: number) => ({ margin: { top, left, right, bottom } });
const onSand = { typography: { text: { color: TEXT } } };

type Mark = { type: "bold" } | { type: "link"; attrs: { href: string } };
type Run = { text: string; bold?: boolean; href?: string };
const runs = (parts: Run[]) =>
  parts.map((p) => {
    const marks: Mark[] = [...(p.bold ? [{ type: "bold" } as const] : []), ...(p.href ? [{ type: "link", attrs: { href: p.href } } as const] : [])];
    return { type: "text", text: p.text, ...(marks.length ? { marks } : {}) };
  });
const para = (...parts: Run[]) => ({ type: "paragraph", content: runs(parts) });
const doc = (...content: unknown[]) => ({ type: "doc", content });
const rich = (content: unknown[], extra: Record<string, unknown> = {}) => ({ id: id(), type: "richText", doc: doc(...content), ...extra });
const lead = (bold: string, rest: string, extra: Record<string, unknown> = {}) => rich([para({ text: bold, bold: true }, ...(rest ? [{ text: ` ${rest}` }] : []))], extra);

const dual = (level: 1 | 2, eyebrow: string, title: string, tone: "light-color" | "dark-color", extra: Record<string, unknown> = {}) => ({
  id: id(),
  type: "heading",
  level,
  stack: true,
  className: "heading-on-light",
  text: `<span class="super-heading ${tone}${level === 1 ? " green-text" : ""}">${eyebrow}</span>`,
  second: title,
  typography: { ...(level === 2 ? { text: { color: TEXT } } : {}), first: { size: { unit: "px", value: level === 1 ? 30 : 18 } } },
  ...extra,
});
const h3 = (first: string, rest: string) => ({
  id: id(),
  type: "heading",
  level: 3,
  text: `<span class="green-text ts-colour">${first}</span> ${rest}`,
  typography: { text: { size: { unit: "px", value: 30 } } },
});
const checks = (lines: string[], extra: Record<string, unknown> = {}) => ({
  id: id(),
  type: "iconList",
  items: lines.map((text) => ({ id: id(), icon: "check", text, href: "" })),
  iconSize: "lg",
  iconColor: ICON,
  gap: 21,
  typography: { text: { size: { unit: "px", value: 18 } } },
  ...extra,
});
const mainAction = (label = "Get Started with Flow", href = "/sign-up") => ({
  id: id(),
  type: "dualButton",
  first: { label, href },
  second: { label: "", href: "", variant: "outline" },
  size: "lg",
  shape: "pill",
  gap: 30,
  align: "center",
  motion: { enter: { effect: "blur-up" } },
  style: margin(26, 0, 0, 30),
  at: { sm: { stack: true, style: margin(10, 20, 20, 30) } },
});
const textLink = (text: string, href: string) => rich([para({ text, href })], { style: margin(-20, 0, 0, 0), typography: { text: { align: "center" } } });
const card = (first: string, rest: string, bold: string, words: string) => ({
  id: id(),
  ...onSand,
  radius: 20,
  background: { type: "color", color: SAND, opacity: 6 },
  style: pad(40, 24, 46),
  blocks: [h3(first, rest), lead(bold, words)],
});

const TRY = "/admin/try";
const TITLE = "Try the page builder";

function tryPage() {
  const rows = [
    // 1. The hero (6.1): the one main action is *Start building*; signing up is the second action, a text link (5.3).
    {
      id: id(), type: "row", layout: "1", align: "middle", height: 50, style: pad(150, 20, 100), background: HERO_BG, backgroundFixed: true,
      contentMax: 968, typography: { text: { align: "center" } }, at: { sm: { height: 100, style: pad(0, 20, 0) } },
      columns: [{
        id: id(),
        blocks: [
          dual(1, "No sign-up", "Try the Kaizena Page Builder", "dark-color"),
          lead("Build pages in the real page builder, on a store of your own.", "It is free, only you can see it, and there is nothing to install."),
          mainAction("Start building", TRY),
          textLink("Or get started with Flow", "/sign-up"),
          checks(["A store of your own", "Private to you", "No card, no account"], { layout: "row", position: "center", gap: 20, typography: { text: { weight: 500 } }, visibility: { hideAt: ["sm"] } }),
        ],
      }],
    },
    // 2. How it works, as three cards (6.4).
    {
      id: id(), type: "row", layout: "1", moreLines: ["3"], gap: 40, style: pad(100, 20, 100), background: TURN_A, backgroundFixed: true,
      contentMax: 1000, equalHeight: true, typography: { text: { align: "center" } }, at: { sm: { contentMax: 320 } },
      columns: [
        { id: id(), ...onSand, blocks: [dual(2, "How it works", "Three steps, no account", "light-color"), lead("Press one button and start.", "Your store opens in the builder, ready to change.")] },
        card("Start", "in one press", "Press Start building.", "A finished-looking store opens in the page builder, with a few things to try beside it."),
        card("Change", "anything you like", "Edit the words, the pictures and the layout, or try another look.", "Upload your own pictures, or let the AI make one or change a page from a few words, on a small allowance."),
        card("Keep", "it if you like it", "Press Keep this store and tell us who you are.", "Your pages come with you, and the store stays private until you open it."),
      ],
    },
    // 3. The real builder: the text beside a list (6.3).
    {
      id: id(), type: "row", layout: "2", align: "middle", gap: 70, style: pad(100, 20, 100), background: TURN_B, backgroundFixed: true,
      contentMax: 1000, at: { sm: { contentMax: 320, reverse: true } },
      columns: [
        { id: id(), ...onSand, width: 60, blocks: [checks(["Pages, articles, headers and footers", "Free themes from the theme store, in one press", "Pictures made by AI, and changes described in words", "Your page on a phone, a tablet and a computer"])] },
        {
          id: id(), ...onSand, width: 40, radius: 20, style: pad(40, 0, 40),
          blocks: [
            dual(2, "The real thing", "The builder our store owners use", "dark-color"),
            lead("Nothing is cut down for the try.", "The theme, versions, every screen size and your own CSS are all there, and you can see your store as a visitor would."),
          ],
        },
      ],
    },
    // 4. Questions (the FAQ, boxed).
    {
      id: id(), type: "row", layout: "1", style: pad(100, 20, 100), background: TURN_A, backgroundFixed: true, contentMax: 880,
      at: { sm: { contentMax: 320 } },
      columns: [{
        id: id(), ...onSand,
        blocks: [
          dual(2, "Good to know", "Your questions, answered", "light-color", { typography: { text: { color: TEXT, align: "center" }, first: { size: { unit: "px", value: 18 } } } }),
          {
            id: id(), type: "faq", look: "boxed", single: true,
            items: [
              ["Do I need an account?", "No.", "Press Start building and your store opens. We ask for your email only if you choose to keep it."],
              ["Who can see my store?", "Only you.", "It is private, and only the browser you started it in can open it."],
              ["How long does it last?", "7 days after your last visit, 30 at most.", "Then it is closed, and what you put in it is deleted."],
              ["Can I keep what I made?", "Yes.", "Press Keep this store. Once you have signed up, the store with your pages is yours."],
              ["Does it cost anything?", "No.", "Trying is free. The AI and uploads have a small allowance, enough to see what they do."],
            ].map(([q, bold, rest]) => ({ id: id(), title: q, body: doc(para({ text: bold, bold: true }, { text: ` ${rest}` })) })),
          },
        ],
      }],
    },
    // 5. The end: the main action again (6.7).
    {
      id: id(), type: "row", layout: "1", align: "middle", style: pad(100, 20, 100), background: { ...TURN_B, angle: 215 }, backgroundFixed: true,
      contentMax: 968, typography: { text: { align: "center" } }, at: { sm: { contentMax: 320 } },
      columns: [{
        id: id(), ...onSand,
        blocks: [
          dual(2, "Ready?", "Build your first page now", "dark-color"),
          lead("It takes one press.", "No account and no card."),
          mainAction("Start building", TRY),
        ],
      }],
    },
  ];
  return {
    title: TITLE,
    slug: pageSlugFromTitle(TITLE),
    seo: {
      title: "Try the page builder, free | Kaizena Flow",
      description: "Build pages in Kaizena Flow's real page builder, on a private store of your own. No sign-up and nothing to install.",
    },
    rows,
    tags: [],
    categories: [],
    thumbnail: null,
    aiAssistants: true,
    searchEngines: true,
  };
}

const theme = {
  base: "minimal",
  savedId: null,
  settings: {
    mode: "auto",
    light: { text: "#171717", muted: "#525252", accent: "#171717", border: "#e5e5e5", surface: "#f5f5f4", accentText: "#ffffff", background: "#ffffff" },
    dark: { text: "#ededed", muted: "#a3a3a3", accent: "#ededed", border: "#2e2e2e", surface: "#1c1c1c", accentText: "#0a0a0a", background: "#1c1c1c" },
    fonts: { body: "Inter", heading: "Montserrat" },
    buttons: { style: "filled", corners: "pill" },
    visitorSwitch: false,
  },
};
const styles = [
  { slug: "green-text", kind: "colour", settings: { color: "#557400", weight: 700 }, css: null },
  { slug: "colour", kind: "colour", settings: { color: "#242a60", weight: 700 }, css: null },
] as const;

const OUT = path.join(tmpdir(), "kaizena-site-pages");
mkdirSync(OUT, { recursive: true });

it("builds the Try the page builder page as the editor would save it, with no issue and no claim", () => {
  const page = tryPage();
  expect(page.slug).toBe("try-the-page-builder");
  expect(pageSlugProblem(page.slug)).toBeNull();
  expect(page.seo.title.length).toBeLessThan(60);
  expect(page.seo.description.length).toBeLessThan(160);
  const parsed = pageInput.safeParse(page);
  if (!parsed.success) writeFileSync(path.join(OUT, "try-the-page-builder.errors.json"), JSON.stringify(parsed.error.issues, null, 1));
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;
  const sets = themeSetsOf(parseStoreTheme(theme).settings);
  const issues = pageIssues(parsed.data, { theme: { sets }, siteCss: textStylesCss(styles as never) });
  const said: string[] = [];
  const walk = (v: unknown, k = ""): void => {
    if (typeof v === "string") {
      if (["text", "second", "label", "title", "description"].includes(k)) said.push(inlinePlain(v));
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, k));
    else if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v)) walk(vv, kk);
  };
  walk(parsed.data);
  const check = {
    issues: issues.map((i) => [i.rule, i.severity, i.where, i.message]),
    blocking: blockingIssues(issues).length,
    claims: findClaims(said.join("\n")),
  };
  writeFileSync(path.join(OUT, "try-the-page-builder.check.json"), JSON.stringify(check, null, 1));
  writeFileSync(path.join(OUT, "try-the-page-builder.page.json"), JSON.stringify(parsed.data));
  expect(check.blocking).toBe(0);
});

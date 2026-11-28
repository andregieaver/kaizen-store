/**
 * The Kaizena Life site importer (D916, `docs/life-site-move.md`): builds Life's pages from lifesaver-app's message files, in English with
 * Norwegian and Swedish as translations, checks each as the page editor's save does (`pageInput`, `pageIssues()`), and saves it as a
 * draft through the store's Admin API (`POST /pages`, or `PATCH /pages/{id}` for a page of the same address made before). Nothing on
 * the site changes until the owner publishes. Run with `node scripts/life-site/run.mjs` (its header has the arguments).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { pageIssues } from "@/lib/page-a11y";
import { pageInput, type PageContent, type PageTranslation } from "@/lib/page-content";
import { cleanTranslations, pageTexts, translationOf, withTranslation } from "@/lib/page-translation";

import { LANGS, LOCALES, Words } from "./kit";
import { PAGES, type LifePage } from "./pages";

type Args = { life: string; base: string | null; host: string | null; tokenFile: string | null; dry: string | null; only: string[] | null };

function args(argv: string[]): Args {
  const value = (name: string) => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? (argv[at + 1] ?? null) : null;
  };
  return {
    life: value("life") ?? "../lifesaver-app",
    base: value("base"),
    host: value("host"),
    tokenFile: value("token-file"),
    dry: value("dry"),
    only: value("only")?.split(",").map((name) => name.trim()) ?? null,
  };
}

/** A built page as the editor keeps it: its English words, and a translation for each other language. */
function content(built: Record<(typeof LANGS)[number], LifePage>): PageContent {
  const page = (version: LifePage) => ({
    title: version.title,
    slug: version.slug,
    thumbnail: null,
    seo: version.seo,
    searchEngines: true,
    aiAssistants: true,
    categories: [],
    tags: [],
    rows: version.rows,
  });
  const parse = (version: LifePage, lang: string): PageContent => {
    const parsed = pageInput.safeParse(page(version));
    if (!parsed.success) throw new Error(`${version.slug} (${lang}): ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    return parsed.data as PageContent;
  };
  let english = parse(built.en, "en");
  const limits = pageTexts(english);
  for (const lang of ["nb", "sv"] as const) english = withTranslation(english, LOCALES[lang], fitted(translationOf(english, parse(built[lang], lang)), limits, `${built.en.slug} (${lang})`));
  // The save's own check of the translations, as the API runs it.
  const checked = cleanTranslations(english, Object.values(LOCALES).map((locale) => ({ locale, name: locale })));
  if (!checked.ok) throw new Error(`${built.en.slug}: ${checked.problems.join(" ")}`);
  return checked.content;
}

/** A translation within each text's longest length: a search engine's title or description cut at a word, anything else refused by name. */
function fitted(translation: PageTranslation, limits: ReturnType<typeof pageTexts>, where: string): PageTranslation {
  const out: PageTranslation = {};
  for (const [key, value] of Object.entries(translation)) {
    const max = limits.get(key)?.max ?? 0;
    if (typeof value !== "string" || max === 0 || value.length <= max) out[key] = value;
    else if (key.startsWith("seo.")) out[key] = `${value.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
    else throw new Error(`${where}: ${key} is ${value.length} characters, over ${max}.`);
  }
  return out;
}

async function api(a: Args, path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (a.host) headers.set("host", a.host);
  // Locally the token is read from a file; on the real store the session's network proxy adds it.
  if (a.tokenFile) headers.set("authorization", `Bearer ${readFileSync(a.tokenFile, "utf8").trim()}`);
  const response = await fetch(`${a.base}/api/admin/v1${path}`, { ...init, headers });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body).slice(0, 500)}`);
  return body;
}

/** The store's pages by address, every page of the list. */
async function pagesBySlug(a: Args): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  let after: string | null = null;
  do {
    const page = (await api(a, `/pages?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`)) as { data: { id: string; slug: string }[]; next?: string | null };
    for (const entry of page.data) found.set(entry.slug, entry.id);
    after = page.next ?? null;
  } while (after);
  return found;
}

async function main() {
  const a = args(process.argv.slice(2));
  const words = Object.fromEntries(LANGS.map((lang) => [lang, new Words(a.life, lang)])) as Record<(typeof LANGS)[number], Words>;
  const names = a.only ?? Object.keys(PAGES);
  const existing = a.dry || !a.base ? new Map<string, string>() : await pagesBySlug(a);
  for (const name of names) {
    const build = PAGES[name];
    if (!build) throw new Error(`No page called ${name}: ${Object.keys(PAGES).join(", ")}`);
    const draft = content({ en: build(words.en), nb: build(words.nb), sv: build(words.sv) });
    const issues = pageIssues(draft);
    // What would stop the owner publishing (`blocking`) stops the import too; warnings are listed for the owner.
    const serious = issues.filter((issue) => issue.severity === "blocking");
    console.log(`${name} (/${draft.slug}): ${Object.keys(draft.translations ?? {}).join(", ")} translated; ${issues.length} notes, ${serious.length} blocking`);
    for (const issue of issues) console.log(`  ${issue.severity}: ${issue.where}: ${issue.message}`);
    if (serious.length > 0) throw new Error(`${name} has notes that would stop its publishing; nothing saved.`);
    if (a.dry) {
      mkdirSync(a.dry, { recursive: true });
      writeFileSync(join(a.dry, `${name}.json`), JSON.stringify(draft, null, 2));
      continue;
    }
    if (!a.base) throw new Error("Give --base (the store's address) or --dry DIR.");
    const id = existing.get(draft.slug);
    if (id) await api(a, `/pages/${id}`, { method: "PATCH", body: JSON.stringify({ draft }) });
    else await api(a, "/pages", { method: "POST", body: JSON.stringify({ draft }) });
    console.log(`  saved as a draft (${id ? "updated" : "new"})`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

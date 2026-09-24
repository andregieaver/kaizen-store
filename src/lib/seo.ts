import { z } from "zod";

/**
 * Search and sharing (decision D21): what stores and Kaizen tell search
 * engines, social sites and AI assistants. Pure helpers, shared by the
 * storefront, the admin and the robots.txt, sitemap and llms.txt routes.
 */

/** Longest title and description search engines show in full (guidance, not a limit). */
export const TITLE_ADVICE = 60;
export const DESCRIPTION_ADVICE = 160;
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 320;
export const RULES_MAX = 5_000;
export const LLMS_MAX = 20_000;

/** A store's (or Kaizen's) search and sharing settings. */
export type StoreSeo = {
  /** Home page title per locale; empty uses the store's name. */
  title: Record<string, string>;
  /** Home page description per locale. */
  description: Record<string, string>;
  /** The picture shown when a page without its own picture is shared. */
  image: { url: string; alt: Record<string, string> } | null;
  /** The business's profiles elsewhere (Instagram, Facebook, …), for schema.org `sameAs`. */
  sameAs: string[];
  /** Keep the store out of search engines even once it is open. */
  hidden: boolean;
  /** AI search engines and assistants (ChatGPT search, Claude, Perplexity) may read pages to answer people. */
  aiAssistants: boolean;
  /** AI companies may collect pages to train their models. */
  aiTraining: boolean;
  /** Extra robots.txt rules, written as if the store were at the root. */
  robots: string;
  /** The owner's own text in llms.txt (Markdown). */
  llms: string;
  /** Site verification codes for search consoles. */
  verification: { google: string; bing: string };
};

const localized = z.record(z.string(), z.string()).catch({});

const storedSeo = z.object({
  title: localized.default({}),
  description: localized.default({}),
  image: z
    .object({ url: z.string(), alt: localized.default({}) })
    .nullable()
    .catch(null)
    .default(null),
  sameAs: z.array(z.string()).catch([]).default([]),
  hidden: z.boolean().catch(false).default(false),
  aiAssistants: z.boolean().catch(true).default(true),
  aiTraining: z.boolean().catch(true).default(true),
  robots: z.string().catch("").default(""),
  llms: z.string().catch("").default(""),
  verification: z
    .object({ google: z.string().catch("").default(""), bing: z.string().catch("").default("") })
    .catch({ google: "", bing: "" })
    .default({ google: "", bing: "" }),
});

/** Reads saved settings; anything missing or malformed gets its default. */
export function parseStoreSeo(value: unknown): StoreSeo {
  const parsed = storedSeo.safeParse(value ?? {});
  return parsed.success ? parsed.data : storedSeo.parse({});
}

/** A verification code as Google and Bing give it: letters, digits, `-` and `_`. */
const verificationCode = z
  .string()
  .trim()
  .max(100)
  .transform((value) => value.match(/content="([^"]+)"/)?.[1] ?? value)
  .refine((value) => /^[A-Za-z0-9_-]*$/.test(value), {
    message: "A verification code is letters, digits, - and _. Paste the code or the whole meta tag.",
  });

/** What the settings form may send, with the checks shown to the owner. */
export const storeSeoInput = z.object({
  title: z.record(z.string(), z.string().trim().max(TITLE_MAX, `Keep titles under ${TITLE_MAX} characters.`)),
  description: z.record(
    z.string(),
    z.string().trim().max(DESCRIPTION_MAX, `Keep descriptions under ${DESCRIPTION_MAX} characters.`),
  ),
  image: z
    .object({
      url: z.url("The share picture has an invalid address.").max(1000),
      alt: z.record(z.string(), z.string().trim().max(300)),
    })
    .nullable(),
  sameAs: z
    .array(z.url("Profiles must be full web addresses, starting with https://.").max(300))
    .max(20, "Add at most 20 profiles."),
  hidden: z.boolean(),
  aiAssistants: z.boolean(),
  aiTraining: z.boolean(),
  robots: z.string().max(RULES_MAX, `Keep the rules under ${RULES_MAX} characters.`),
  llms: z.string().trim().max(LLMS_MAX, `Keep the text under ${LLMS_MAX} characters.`),
  verification: z.object({ google: verificationCode, bing: verificationCode }),
});

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Text for a description tag: one line, cut at a word near `max` characters. */
export function summarize(text: string, max = DESCRIPTION_ADVICE): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

/** `nb-NO` → `nb_NO`, the form Open Graph uses. */
export function ogLocale(locale: string): string {
  return locale.replace("-", "_");
}

/** An address that works outside the site: relative paths get the site's origin. */
export function absoluteUrl(url: string, origin: string): string {
  return /^https?:\/\//.test(url) ? url : `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

/** AI assistants and AI search: they fetch pages to answer a person's question. */
export const AI_ASSISTANT_BOTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "MistralAI-User",
] as const;

/** Crawlers that collect pages to train AI models. */
export const AI_TRAINING_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "meta-externalagent",
] as const;

type Rule = { allow: boolean; path: string };
/** Rules per user agent, `*` for everyone. */
export type RobotsGroups = Map<string, Rule[]>;

/**
 * Reads robots.txt rules as an owner writes them: `User-agent`, `Allow` and
 * `Disallow` lines (`Sitemap` only where `sitemaps` is on), `#` comments.
 * Rules before any `User-agent` line are for everyone. Paths get `prefix`,
 * so a store's `/private` becomes `/s/{store}/private`.
 */
export function parseRobotsRules(
  text: string,
  { prefix = "", sitemaps = false }: { prefix?: string; sitemaps?: boolean } = {},
): { groups: RobotsGroups; sitemaps: string[]; problems: string[] } {
  const groups: RobotsGroups = new Map();
  const found: string[] = [];
  const problems: string[] = [];
  let agents: string[] = ["*"];
  let lastWasAgent = false;

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) return;
    const where = `Line ${index + 1}`;
    const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!match) {
      problems.push(`${where}: write a rule as "Disallow: /path".`);
      return;
    }
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === "user-agent") {
      if (!/^[A-Za-z0-9*._-]+$/.test(value)) {
        problems.push(`${where}: "${value}" is not a crawler name.`);
        return;
      }
      agents = lastWasAgent ? [...agents, value] : [value];
      lastWasAgent = true;
      return;
    }
    lastWasAgent = false;
    if (field === "allow" || field === "disallow") {
      if (value === "") return; // "Disallow:" with nothing allows everything: nothing to add.
      if (!/^[/*]/.test(value) || /\s/.test(value)) {
        problems.push(`${where}: a path starts with / (for example /private).`);
        return;
      }
      const path = `${prefix}${value.startsWith("*") ? "/" : ""}${value}`;
      for (const agent of agents) {
        groups.set(agent, [...(groups.get(agent) ?? []), { allow: field === "allow", path }]);
      }
      return;
    }
    if (field === "sitemap" && sitemaps) {
      if (/^https?:\/\/\S+$/.test(value)) found.push(value);
      else problems.push(`${where}: a sitemap is a full web address.`);
      return;
    }
    problems.push(`${where}: "${match[1]}" is not supported here. Use User-agent, Allow or Disallow.`);
  });
  return { groups, sitemaps: found, problems };
}

/** Adds rules to groups, in place. */
export function addRules(groups: RobotsGroups, agents: readonly string[], rules: Rule[]): void {
  for (const agent of agents) groups.set(agent, [...(groups.get(agent) ?? []), ...rules]);
}

export function mergeGroups(target: RobotsGroups, source: RobotsGroups): void {
  for (const [agent, rules] of source) addRules(target, [agent], rules);
}

/**
 * robots.txt text. A crawler follows only the group that names it, so the
 * rules for everyone are repeated in each named group.
 */
export function renderRobots(groups: RobotsGroups, sitemaps: string[]): string {
  const everyone = groups.get("*") ?? [];
  const named = [...groups.keys()].filter((agent) => agent !== "*").sort();
  const block = (agent: string, rules: Rule[]) => {
    const unique = [...new Map(rules.map((r) => [`${r.allow}${r.path}`, r])).values()];
    const lines = unique.map((r) => `${r.allow ? "Allow" : "Disallow"}: ${r.path}`);
    return [`User-agent: ${agent}`, ...(lines.length > 0 ? lines : ["Allow: /"])].join("\n");
  };
  return [
    block("*", everyone),
    ...named.map((agent) => block(agent, [...everyone, ...(groups.get(agent) ?? [])])),
    ...[...new Set(sitemaps)].map((url) => `Sitemap: ${url}`),
  ].join("\n\n") + "\n";
}

/** Where a store's shopper-only pages are: carts, checkout and order pages are not for crawlers. */
export function storePrivatePaths(base: string): Rule[] {
  return [
    { allow: false, path: `${base}/*/cart` },
    { allow: false, path: `${base}/*/checkout` },
    { allow: false, path: `${base}/*/order/` },
  ];
}

/** A store's own rules and AI choices, as groups for the robots.txt it is served under. */
export function storeRobotsGroups(seo: StoreSeo, base: string): RobotsGroups {
  const groups = parseRobotsRules(seo.robots, { prefix: base }).groups;
  addRules(groups, ["*"], storePrivatePaths(base));
  const all = [{ allow: false, path: `${base}/` }];
  if (!seo.aiAssistants) addRules(groups, AI_ASSISTANT_BOTS, all);
  if (!seo.aiTraining) addRules(groups, AI_TRAINING_BOTS, all);
  return groups;
}

// ---------------------------------------------------------------------------
// llms.txt (llmstxt.org)
// ---------------------------------------------------------------------------

export type LlmsLink = { title: string; url: string; note?: string };

/** An llms.txt file: name, summary, free text, then sections of links. */
export function renderLlms({
  name,
  summary,
  text,
  sections,
}: {
  name: string;
  summary: string;
  text?: string;
  sections: { heading: string; links?: LlmsLink[]; lines?: string[] }[];
}): string {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  const parts = [`# ${clean(name)}`, `> ${clean(summary)}`];
  if (text?.trim()) parts.push(text.trim());
  for (const section of sections) {
    const items = [
      ...(section.lines ?? []).map((line) => `- ${clean(line)}`),
      ...(section.links ?? []).map(
        (link) => `- [${clean(link.title).replace(/[[\]]/g, "")}](${link.url})${link.note ? `: ${clean(link.note)}` : ""}`,
      ),
    ];
    if (items.length > 0) parts.push(`## ${section.heading}\n\n${items.join("\n")}`);
  }
  return `${parts.join("\n\n")}\n`;
}

// ---------------------------------------------------------------------------
// schema.org
// ---------------------------------------------------------------------------

export type JsonLd = Record<string, unknown>;

/** A JSON-LD script body that cannot close the script tag early. */
export function jsonLdText(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** Schema.org properties Google reads for variants, by option name in any launch language. */
const VARIES_BY: [RegExp, string][] = [
  [/^(size|størrelse|storlek|str\.?)$/i, "size"],
  [/^(colou?r|farge|färg|farve)$/i, "color"],
  [/^(material|materiale)$/i, "material"],
  [/^(pattern|mønster|mönster)$/i, "pattern"],
];

export function schemaProperty(optionName: string): string | null {
  return VARIES_BY.find(([pattern]) => pattern.test(optionName.trim()))?.[1] ?? null;
}

/** Price in major units as schema.org wants it: "249.00". */
export function schemaPrice(amountMinor: number, digits: number): string {
  return (amountMinor / 10 ** digits).toFixed(digits);
}

/**
 * The settings form's fields as settings: `title:{locale}`,
 * `description:{locale}`, `imageUrl`, `imageAlt:{locale}`, `sameAs` (one
 * address per line), the `hidden`, `aiAssistants` and `aiTraining` boxes,
 * `robots`, `llms`, `google` and `bing`. Checked with `storeSeoInput`.
 */
export function seoFromForm(form: FormData, locales: readonly string[]): unknown {
  const field = (name: string) => String(form.get(name) ?? "");
  const byLocale = (prefix: string) => Object.fromEntries(locales.map((l) => [l, field(`${prefix}:${l}`).trim()]));
  const imageUrl = field("imageUrl").trim();
  return {
    title: byLocale("title"),
    description: byLocale("description"),
    image: imageUrl ? { url: imageUrl, alt: byLocale("imageAlt") } : null,
    sameAs: field("sameAs")
      .split(/\s+/)
      .map((line) => line.trim())
      .filter(Boolean),
    hidden: form.get("hidden") === "on",
    // Kaizen's own settings have no AI boxes: both stay allowed.
    aiAssistants: form.has("aiChoices") ? form.get("aiAssistants") === "on" : true,
    aiTraining: form.has("aiChoices") ? form.get("aiTraining") === "on" : true,
    robots: field("robots"),
    llms: field("llms"),
    verification: { google: field("google"), bing: field("bing") },
  };
}

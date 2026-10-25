/**
 * Cuts an official legal text into passages, by route (D311, unit L, `docs/ai-autopilot.md` 8.2): the articles and annexes of an EU act from
 * Cellar's XHTML, the sections of a Swedish act from Riksdagen's text, the sections of a Danish act from Retsinformation's XML, and the
 * sections of a Norwegian act from Lovdata's open data. Pure and free of server-only modules, so each route is tested on a stored answer;
 * nothing here guesses: a text whose shape is not the route's gives no passages, and the read fails.
 */
export type Passage = {
  /** `art_9`, `anx_I`, `2:10`, `18`, `gdpr/a13`: see `src/lib/legal-sources.ts`. */
  key: string;
  /** As a page cites it: `Article 9 — Right of withdrawal`, `2 kap. 10 §`, `§ 18`, `§ 21. Angrefristen`. */
  title: string;
  text: string;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/**
 * A text as passages hold it and quotes are compared with: soft hyphens gone, every run of white space one space, typographic quotation
 * marks and apostrophes as plain ones, trimmed. A quote is checked against a passage after the same treatment (`normalisedLegalText()`).
 */
export function normalisedLegalText(text: string): string {
  return text
    .replace(/­/g, "")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Text of a fragment of markup: tags out, entities decoded. */
const plain = (markup: string): string => normalisedLegalText(decode(markup.replace(/<[^>]*>/g, " ")));

/** The element that opens at `start` (`<div …>` or `<Paragraf …>`), up to and including its closing tag, counting nested ones of its name. */
export function elementAt(markup: string, start: number, name: string): string | null {
  const tag = new RegExp(`<(/?)${name}\\b[^>]*?(/?)>`, "g");
  tag.lastIndex = start;
  let depth = 0;
  for (let m = tag.exec(markup); m; m = tag.exec(markup)) {
    if (m[2] === "/") continue;
    depth += m[1] === "/" ? -1 : 1;
    if (depth === 0) return markup.slice(start, m.index + m[0].length);
  }
  return null;
}

// ---------------------------------------------------------------------------
// EU law: Cellar's XHTML
// ---------------------------------------------------------------------------

/** The consolidation markers Cellar prints (`▼M2`, `►M2`, `◄`, `▼B`), never part of the law's words. */
const MARKERS = /[▼►]\s*[A-Z]\d*|◄/g;

/**
 * The articles (`art_9`), annexes (`anx_I`) and starred footnotes (`fn_star1`) of an EU act. Each article or annex is a `div` with that id (`eli-subdivision` for an article); the notes of which act changed a
 * paragraph (`p.modref`) and the consolidation markers are left out. The ids are the same in every language.
 */
export function cellarPassages(xhtml: string): Passage[] {
  const out: Passage[] = [];
  const seen = new Set<string>();
  for (const m of xhtml.matchAll(/<div (?:class="eli-subdivision" )?id="((?:art|anx)_[0-9A-Za-z]+)">/g)) {
    const key = m[1];
    if (seen.has(key)) continue;
    const element = elementAt(xhtml, m.index ?? 0, "div");
    if (!element) continue;
    const body = element.replace(/<p class="modref">[\s\S]*?<\/p>/g, " ");
    const heading = plain(/<p class="(?:title-article-norm|title-annex-1|doc-ti)"[^>]*>([\s\S]*?)<\/p>/.exec(body)?.[1] ?? "");
    const subtitle = plain(/<p class="stitle-article-norm"[^>]*>([\s\S]*?)<\/p>/.exec(body)?.[1] ?? "");
    const text = normalisedLegalText(plain(body).replace(MARKERS, " "));
    if (!text) continue;
    seen.add(key);
    const title = key.startsWith("anx_") ? `Annex ${key.slice(4)}` : [heading.replace(MARKERS, "").trim(), subtitle.replace(MARKERS, "").trim()].filter(Boolean).join(" — ");
    out.push({ key, title, text });
  }
  // A starred footnote is part of the text it marks (the model withdrawal form's `(*) Delete as appropriate.`): kept as `fn_star1`.
  for (const m of xhtml.matchAll(/<p class="footnote">([\s\S]*?)<\/p>/g)) {
    const star = /<span class="superscript">\s*\*(\d+)\s*<\/span>/.exec(m[1]);
    if (!star) continue;
    const key = `fn_star${star[1]}`;
    const text = plain(m[1].replace(/<a\b[\s\S]*?<\/a>/, " ")).replace(/^\(\s*\)\s*/, "");
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, title: `(*${star[1]})`, text });
  }
  return out;
}

/**
 * The newest consolidated version of an act from the SPARQL answer (CSV of CELEX numbers): consolidated versions are `0` and the act's
 * number without its sector digit, then the date, as `02011L0083-20260927`. The act itself when none is listed.
 */
export function latestConsolidation(csv: string, celex: string): string {
  const prefix = `0${celex.slice(1)}-`;
  const versions = [...csv.matchAll(/"?(0\d{4}[A-Z]\d{4}-\d{8})"?/g)].map((m) => m[1]).filter((c) => c.startsWith(prefix));
  return versions.sort().at(-1) ?? celex;
}

/**
 * The language an EU act's passages are written in, from its commonest small words (Cellar's XHTML does not say, and answers in another
 * language when it has none in the one asked for): `sv`, `da` or `en`, or null when none stands out.
 */
export function cellarLanguage(passages: readonly Passage[]): "sv" | "da" | "en" | null {
  const text = ` ${passages.map((p) => p.text).join(" ").toLowerCase()} `;
  const count = (word: string) => text.split(` ${word} `).length - 1;
  const scores = { sv: count("och") + count("att"), da: count("og") + count("af"), en: count("the") + count("and") } as const;
  const [best, second] = (Object.entries(scores) as ["sv" | "da" | "en", number][]).sort((a, b) => b[1] - a[1]);
  return best[1] > 0 && best[1] >= second[1] * 3 ? best[0] : null;
}

/** The SPARQL query that lists an act's consolidated versions. */
export function consolidationQuery(celex: string): string {
  return `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#> SELECT DISTINCT ?c WHERE { ?w cdm:resource_legal_id_celex ?c . FILTER(STRSTARTS(STR(?c), "0${celex.slice(1)}-")) }`;
}

// ---------------------------------------------------------------------------
// Swedish law: Riksdagen's text
// ---------------------------------------------------------------------------

const CHAPTER = /^(\d+) kap\. (.*)$/;
const SECTION = /^(\d+)(?: ([a-z]))? § ?(.*)$/;
const IN_FORCE_FROM = /^\/Träder i kraft I:(\d{4}-\d{2}-\d{2})\/\s*/;
const IN_FORCE_UNTIL = /^\/Upphör att gälla U:(\d{4}-\d{2}-\d{2})\/\s*/;

/**
 * The sections of a Swedish act as Riksdagen prints it: a chapter (`2 kap. …`) or a section (`10 §`, `10 a §`) starts a line after a blank
 * line (a line inside a paragraph that starts with a reference such as `12 § (ångerfrist)` does not). A section printed twice, one ceasing
 * and one taking effect on a date, is the version in force on `today` (YYYY-MM-DD). A repealed section is left out. A short line alone
 * between blank lines just before a section is its heading.
 */
export function riksdagenPassages(text: string, today: string): Passage[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const sections: { key: string; title: string; heading: string; lines: string[] }[] = [];
  let chapter: string | null = null;
  let started = false;
  let current: (typeof sections)[number] | null = null;
  /** Lines after a chapter's title and before its first section: the first section's heading, if any. */
  let loose: string[] = [];
  const isHeading = (line: string | undefined) => Boolean(line && line.trim() && line.trim().length <= 80 && !/[.:;,]$/.test(line.trim()));
  const blankBefore = (i: number) => i === 0 || lines[i - 1].trim() === "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const ch = CHAPTER.exec(line);
    if (ch && blankBefore(i)) {
      chapter = ch[1];
      started = true;
      current = null;
      loose = [];
      continue;
    }
    const sec = SECTION.exec(line);
    if (sec && blankBefore(i)) {
      started = true;
      const number = `${sec[1]}${sec[2] ?? ""}`;
      const key = chapter ? `${chapter}:${number}` : number;
      // The heading is the previous section's last paragraph when that is one short line without a full stop.
      let heading = "";
      if (!current) {
        const last = loose.filter((l) => l.trim()).at(-1);
        if (isHeading(last)) heading = last!.trim();
      } else {
        const tail = current.lines;
        while (tail.length > 1 && tail[tail.length - 1].trim() === "") tail.pop();
        const end = tail.length - 1;
        if (end >= 1 && tail[end - 1].trim() === "" && isHeading(tail[end])) {
          heading = tail[end].trim();
          tail.length = end;
        }
      }
      current = { key, title: chapter ? `${chapter} kap. ${sec[1]}${sec[2] ? ` ${sec[2]}` : ""} §` : `${sec[1]}${sec[2] ? ` ${sec[2]}` : ""} §`, heading, lines: [sec[3]] };
      sections.push(current);
      loose = [];
      continue;
    }
    if (started && current) current.lines.push(line);
    else if (started) loose.push(line);
  }
  const out = new Map<string, Passage>();
  for (const s of sections) {
    // A word broken at the end of a line (`e-` then `postadress`) is one word again; a dash that starts a line stays.
    let body = normalisedLegalText(s.lines.map((l) => l.trim()).join("\n").replace(/([a-zåäöé])-\n(?=[a-zåäöé])/g, "$1-"));
    const from = IN_FORCE_FROM.exec(body);
    const until = IN_FORCE_UNTIL.exec(body);
    if (from) {
      if (from[1] > today) continue;
      body = body.slice(from[0].length);
    } else if (until) {
      if (until[1] <= today) continue;
      body = body.slice(until[0].length);
    }
    if (!body || /^Har upphävts\b/.test(body)) continue;
    out.set(s.key, { key: s.key, title: s.heading ? `${s.title} (${s.heading})` : s.title, text: body });
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Danish law: Retsinformation's XML
// ---------------------------------------------------------------------------

/** Whether the act is in force (`Valid`), as its XML says. */
export function retsinformationStatus(xml: string): string | null {
  return /<Status>([^<]+)<\/Status>/.exec(xml)?.[1]?.trim() ?? null;
}

/**
 * The sections (`<Paragraf localId="18">`) of a Danish act. The act's body ends at its first `<Ikraft>`: what follows are the commencement
 * provisions of the acts that amended it, whose sections are numbered on their own.
 */
export function retsinformationPassages(xml: string): Passage[] {
  const end = xml.search(/<Ikraft\b/);
  const body = end >= 0 ? xml.slice(0, end) : xml;
  const out: Passage[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/<Paragraf\b[^>]*\blocalId="([^"]+)"[^>]*>/g)) {
    const key = m[1].replace(/\s+/g, "").toLowerCase();
    if (seen.has(key)) continue;
    const element = elementAt(body, m.index ?? 0, "Paragraf");
    if (!element) continue;
    const text = plain(element);
    if (!text) continue;
    seen.add(key);
    out.push({ key, title: `§ ${key.replace(/^(\d+)([a-z])$/, "$1 $2")}`, text });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Norwegian law: Lovdata's open data
// ---------------------------------------------------------------------------

/**
 * One file of a tar archive (ustar or GNU: a 512-byte header with the name and an octal size, then the file padded to 512 bytes), or null.
 * Lovdata's open data is one archive of every act in force (`gjeldende-lover.tar.bz2`), each act a file `nl/nl-{date}-{number}.xml`.
 */
export function tarFile(archive: Uint8Array, name: string): Uint8Array | null {
  const ascii = (from: number, length: number) => {
    let out = "";
    for (let i = from; i < from + length && archive[i] !== 0; i++) out += String.fromCharCode(archive[i]);
    return out;
  };
  for (let at = 0; at + 512 <= archive.length; ) {
    const base = ascii(at, 100);
    if (!base) return null;
    const prefix = ascii(at + 257, 6).startsWith("ustar") ? ascii(at + 345, 155) : "";
    const size = parseInt(ascii(at + 124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) return null;
    const full = prefix ? `${prefix}/${base}` : base;
    if (full === name) return archive.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

/** Which version of the act Lovdata gives: its document id and the date its last change came into force (`NL/lov/2014-06-20-27@2023-10-01`). */
export function lovdataVersion(html: string): string | null {
  const id = /<dd class="dokid">([^<]+)<\/dd>/.exec(html)?.[1]?.trim();
  if (!id) return null;
  const changed = /<dd class="lastChangeInForce">([^<]+)<\/dd>/.exec(html)?.[1]?.trim();
  return changed ? `${id}@${changed}` : id;
}

/**
 * The sections (`§ 20`, key `20`) and, in personopplysningsloven, the GDPR's articles (`gdpr/a13`) of a Norwegian act from Lovdata's open
 * data: each an `article.legalArticle` named by `data-name`, its notes of the acts that changed it (`article.changesToParent`) and its
 * footnote marks left out.
 */
export function lovdataPassages(html: string): Passage[] {
  const out: Passage[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<article class="legalArticle"[^>]*\bdata-name="([^"]+)"[^>]*>/g)) {
    const key = m[1].replace(/^§\s*/, "");
    if (seen.has(key)) continue;
    const element = elementAt(html, m.index ?? 0, "article");
    if (!element) continue;
    let body = element.replace(/<sup class="footnotereference"[\s\S]*?<\/sup>/g, " ");
    for (let at = body.indexOf('<article class="changesToParent"'); at >= 0; at = body.indexOf('<article class="changesToParent"')) {
      const note = elementAt(body, at, "article");
      if (!note) break;
      body = body.slice(0, at) + " " + body.slice(at + note.length);
    }
    // The heading (`h3` to `h5` by depth) is the passage's title, not its text.
    const header = /<(h[2-6]) class="legalArticleHeader">([\s\S]*?)<\/\1>/.exec(body);
    if (header) body = body.replace(header[0], " ");
    const text = plain(body);
    if (!text) continue;
    seen.add(key);
    const fallback = key.startsWith("gdpr/a") ? `Artikkel ${key.slice(6)}` : `§ ${key.replace(/^(\d+)([a-z])$/, "$1 $2")}`;
    const title = plain(header?.[2] ?? "").replace(/\s+\./g, ".") || fallback;
    out.push({ key, title, text });
  }
  return out;
}

/** The keys among `wanted` that the passages do not hold. */
export function missingPassages(passages: readonly Passage[], wanted: readonly string[]): string[] {
  const keys = new Set(passages.map((p) => p.key));
  return wanted.filter((k) => !keys.has(k));
}

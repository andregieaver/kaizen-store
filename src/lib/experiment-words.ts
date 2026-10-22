import { experimentsEn, type ExperimentsMessages } from "./admin-messages/experiments.en";
import { isTestedPlace, type TargetKind } from "./ab-site";

/**
 * A/B tests' sentences in a person's language (D312 A7). The server (`src/server/experiment-admin.ts`, `startProblems()`) and the part
 * labels (`describePart()`) write English, as the AI manager and the tests read it; the admin's screens say them in the account's language
 * through these. Text no template matches stays as it was written.
 */

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Pattern<K> = { key: K; names: string[]; re: RegExp };

function patternsOf<K extends string>(texts: Record<K, string>): Pattern<K>[] {
  return (Object.entries(texts) as [K, string][])
    .map(([key, english]) => {
      const names: string[] = [];
      const source = english
        .split(/(\{\w+\})/)
        .map((part) => {
          const name = /^\{(\w+)\}$/.exec(part)?.[1];
          if (!name) return escape(part);
          names.push(name);
          return "(.+?)";
        })
        .join("");
      return { key, names, re: new RegExp(`^${source}$`, "s") };
    })
    // The longer templates first, so a sentence matches its own and not a shorter one with a placeholder.
    .sort((a, b) => b.re.source.length - a.re.source.length);
}

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);

const PART_PATTERNS = patternsOf(experimentsEn.parts);

/** A part's label (`Row 2`, `Column 1 of row 2`, `Heading “Welcome” in row 1`) in the language; a component's own kind stays as written. */
export function partLabelText(label: string, words: ExperimentsMessages = experimentsEn): string {
  for (const { key, names, re } of PART_PATTERNS) {
    const match = re.exec(label);
    if (match) return fill(words.parts[key], Object.fromEntries(names.map((n, i) => [n, match[i + 1]])));
  }
  return label;
}

/** A version's stored name (`Original`, `Version B`) in the language; a name the owner gave stays as it is. */
export function variantNameText(name: string, words: ExperimentsMessages = experimentsEn): string {
  if (name === experimentsEn.variants.original) return words.variants.original;
  const match = /^Version ([A-D])$/.exec(name);
  return match ? fill(words.variants.version, { key: match[1] }) : name;
}

/** A test's target in a sentence or a table, as `targetLabel()` writes it, in the language. */
export function targetLabelText(kind: TargetKind, slug: string, title: string, role: string | null | undefined, words: ExperimentsMessages = experimentsEn): string {
  if (kind === "page") return `/${slug}`;
  if (kind === "role" && isTestedPlace(role)) return `${words.roles[role]}: ${title}`;
  return `${words.kinds[kind].name}: ${title}`;
}

const PROBLEM_PATTERNS = patternsOf(experimentsEn.problems);

/** A refusal of the server in the language: a version's letter carried over, a part's label and a block's word said in the language too. */
export function experimentProblemText(text: string, words: ExperimentsMessages = experimentsEn): string {
  for (const { key, names, re } of PROBLEM_PATTERNS) {
    const match = re.exec(text);
    if (!match) continue;
    const values = Object.fromEntries(
      names.map((name, i) => {
        const value = match[i + 1];
        if (name === "part") return [name, value === experimentsEn.words.partUnderTest ? words.words.partUnderTest : partLabelText(value, words)];
        if (name === "word") return [name, value === "form" ? words.words.form : words.words.button];
        return [name, value];
      }),
    );
    return fill(words.problems[key], values);
  }
  return text;
}

export const experimentProblems = (problems: readonly string[], words: ExperimentsMessages = experimentsEn): string[] => problems.map((p) => experimentProblemText(p, words));

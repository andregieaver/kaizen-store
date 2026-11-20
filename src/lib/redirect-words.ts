import type { RedirectsMessages } from "./admin-messages/redirects.en";
import { REDIRECTS_WORDS } from "./admin-words/redirects";
import type { Finding } from "./data-job";

/**
 * The redirect manager's sentences in a person's language (D312 A7). The checks (`FINDINGS` in `src/lib/data-job.ts`) and the service
 * (`REDIRECT_PROBLEMS`) write English, as the import's stored findings, the AI manager and the tests read it; the manager's form, table and the
 * report say it in the account's language through these. A sentence no template matches stays as it was written. They run on the server
 * (the pages, and `redirectAnswer()` in each action's answer), so no admin client module holds the English to match (bloat review step 2.26).
 */

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pattern(english: string): { names: string[]; re: RegExp } {
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
  return { names, re: new RegExp(`^${source}$`, "s") };
}

/** The English the checks and the service write, which the patterns match. */
const REDIRECTS_EN = REDIRECTS_WORDS.en;

type FindingKey = keyof RedirectsMessages["findings"];
const FINDING_PATTERNS = new Map(Object.entries(REDIRECTS_EN.findings).map(([code, english]) => [code, pattern(english)]));
const PROBLEM_PATTERNS = Object.entries(REDIRECTS_EN.problems).map(([key, english]) => ({ key: key as keyof RedirectsMessages["problems"], ...pattern(english) }));

/** A row of quoted addresses (`"/a", "/b" and "/c" and 2 more`) with its joining words in the language. */
function addressRow(text: string, words: RedirectsMessages): string {
  const en = REDIRECTS_EN.addressRow;
  const w = words.addressRow;
  if (text === en.none) return w.none;
  const more = new RegExp(` ${escape(en.more).replace("\\{n\\}", "(\\d+)")}$`);
  return text.replace(more, (_, n: string) => ` ${w.more.replace("{n}", n)}`).replace(new RegExp(`" ${en.and} "`, "g"), `" ${w.and} "`);
}

/** A finding of a redirect's check in the language: the sentence of its code with the addresses carried over. */
export function redirectFindingText(finding: Pick<Finding, "code" | "text">, words: RedirectsMessages): string {
  const found = FINDING_PATTERNS.get(finding.code);
  if (!found) return finding.text;
  const match = found.re.exec(finding.text);
  if (!match) return finding.text;
  const values = Object.fromEntries(found.names.map((name, i) => [name, name === "addresses" ? addressRow(match[i + 1], words) : match[i + 1]]));
  return words.findings[finding.code as FindingKey].replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/** The findings of a check, each said in the language. */
export const redirectFindings = <F extends Pick<Finding, "code" | "text">>(findings: readonly F[], words: RedirectsMessages): F[] =>
  findings.map((f) => ({ ...f, text: redirectFindingText(f, words) }));

/** A refusal of the service in the language, with a number or an address carried over. */
export function redirectProblemText(text: string, words: RedirectsMessages): string {
  for (const { key, names, re } of PROBLEM_PATTERNS) {
    const match = re.exec(text);
    if (!match) continue;
    return names.reduce((out, name, i) => out.replace(`{${name}}`, () => match[i + 1]), words.problems[key]);
  }
  return text;
}

export const redirectProblems = (problems: readonly string[], words: RedirectsMessages): string[] => problems.map((p) => redirectProblemText(p, words));

/** An action's answer with its refusals (`problems`, `problem`) and its check's findings said in the language; the rest as it was. */
export function redirectAnswer<T>(answer: T, words: RedirectsMessages): T {
  if (answer === null || typeof answer !== "object") return answer;
  const said: Record<string, unknown> = { ...(answer as Record<string, unknown>) };
  if (Array.isArray(said.problems)) said.problems = redirectProblems(said.problems as string[], words);
  if (typeof said.problem === "string") said.problem = redirectProblemText(said.problem, words);
  if (Array.isArray(said.findings)) said.findings = redirectFindings(said.findings as Pick<Finding, "code" | "text">[], words);
  return said as T;
}

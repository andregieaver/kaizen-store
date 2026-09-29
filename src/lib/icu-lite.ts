/**
 * A small subset of ICU message format for the interface text of languages
 * that are translated by AI (D111): `{0}` for an argument, `{0, plural, one
 * {# day} other {# days}}` (with `#` the number, and `=0` for an exact one)
 * and `{0, select, true {…} other {…}}`. Arguments are by position, as the
 * functions they replace take them. Plural categories come from the
 * language's own rules (`Intl.PluralRules`), so a language with more forms
 * than English (Polish's few and many) writes them all. Pure and shared with
 * the browser.
 */

type Node =
  | string
  | { kind: "arg"; arg: number }
  | { kind: "hash" }
  | { kind: "plural" | "select"; arg: number; options: Record<string, Node[]> };

export class TemplateError extends Error {}

/** The template as a tree; throws `TemplateError` for a brace left open or a form it does not know. */
export function parseTemplate(template: string): Node[] {
  const [nodes, end] = parseUntil(template, 0, false, false);
  if (end !== template.length) throw new TemplateError("A closing brace has no opening one.");
  return nodes;
}

function parseUntil(text: string, from: number, inBraces: boolean, inPlural: boolean): [Node[], number] {
  const nodes: Node[] = [];
  let literal = "";
  let i = from;
  const flush = () => {
    if (literal) nodes.push(literal);
    literal = "";
  };
  while (i < text.length) {
    const c = text[i];
    if (c === "}") {
      if (inBraces) break;
      throw new TemplateError("A closing brace has no opening one.");
    }
    if (c === "#" && inPlural) {
      flush();
      nodes.push({ kind: "hash" });
      i += 1;
      continue;
    }
    if (c !== "{") {
      literal += c;
      i += 1;
      continue;
    }
    flush();
    const close = matchingBrace(text, i);
    nodes.push(parseArgument(text.slice(i + 1, close), inPlural));
    i = close + 1;
  }
  flush();
  return [nodes, i];
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  throw new TemplateError("An opening brace is never closed.");
}

function parseArgument(body: string, inPlural: boolean): Node {
  const simple = /^\s*(\d+)\s*$/.exec(body);
  if (simple) return { kind: "arg", arg: Number(simple[1]) };
  const head = /^\s*(\d+)\s*,\s*(plural|select)\s*,/.exec(body);
  if (!head) throw new TemplateError(`Not a placeholder: {${body.slice(0, 30)}}`);
  const kind = head[2] as "plural" | "select";
  const options: Record<string, Node[]> = {};
  let i = head[0].length;
  const rest = body;
  while (i < rest.length) {
    const name = /^\s*(=\d+|[A-Za-z0-9_]+)\s*\{/.exec(rest.slice(i));
    if (!name) {
      if (rest.slice(i).trim() === "") break;
      throw new TemplateError(`Expected an option in {${body.slice(0, 30)}…}`);
    }
    const open = i + name[0].length - 1;
    const close = matchingBrace(rest, open);
    // A select inside a plural still counts with the plural's #.
    const [inner] = parseUntil(rest.slice(open + 1, close), 0, false, kind === "plural" || inPlural);
    if (name[1] in options) throw new TemplateError(`The option ${name[1]} is given twice.`);
    options[name[1]] = inner;
    i = close + 1;
  }
  if (!("other" in options)) throw new TemplateError(`{${body.slice(0, 20)}…} needs an "other" option.`);
  return { kind, arg: Number(head[1]), options };
}

/** The text with its arguments in, by the rules of `locale`. */
export function formatTemplate(template: string, args: readonly unknown[], locale: string): string {
  return render(parseTemplate(template), args, locale, null);
}

function render(nodes: Node[], args: readonly unknown[], locale: string, count: number | null): string {
  return nodes
    .map((node) => {
      if (typeof node === "string") return node;
      if (node.kind === "arg") return String(args[node.arg] ?? "");
      if (node.kind === "hash") return String(count ?? "#");
      if (node.kind === "select") {
        const chosen = node.options[String(args[node.arg])] ?? node.options.other;
        return render(chosen, args, locale, count);
      }
      const n = Number(args[node.arg]);
      const chosen = node.options[`=${n}`] ?? node.options[new Intl.PluralRules(locale).select(n)] ?? node.options.other;
      return render(chosen, args, locale, n);
    })
    .join("");
}

/** The positions of the arguments a template uses. */
export function templateArguments(template: string): number[] {
  const found = new Set<number>();
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (typeof node === "string" || node.kind === "hash") continue;
      found.add(node.arg);
      if (node.kind !== "arg") Object.values(node.options).forEach(walk);
    }
  };
  walk(parseTemplate(template));
  return [...found].sort((a, b) => a - b);
}

type Shape = { arg: number; kind: "plural" | "select"; names: string[] }[];

function shapeOf(nodes: Node[]): Shape {
  const shape: Shape = [];
  const walk = (list: Node[]) => {
    for (const node of list) {
      if (typeof node === "string" || node.kind === "hash" || node.kind === "arg") continue;
      shape.push({ arg: node.arg, kind: node.kind, names: Object.keys(node.options) });
      Object.values(node.options).forEach(walk);
    }
  };
  walk(nodes);
  return shape;
}

/**
 * Why a translation of `source` cannot be used, or null: it must parse, use
 * the same arguments, choose on the same arguments in the same way (the
 * options of a select are the source's, a plural's are the language's own
 * categories, or exact numbers), and a text with no placeholders must have none.
 */
export function templateProblem(source: string, translated: string, locale: string): string | null {
  let sourceNodes: Node[];
  let nodes: Node[];
  try {
    sourceNodes = parseTemplate(source);
  } catch {
    return null;
  }
  try {
    nodes = parseTemplate(translated);
  } catch (error) {
    return error instanceof TemplateError ? error.message : "The text could not be read.";
  }
  if (translated.trim() === "") return "The text is empty.";
  const want = templateArguments(source).join(",");
  const got = templateArguments(translated).join(",");
  if (want !== got) return `It must use the placeholders ${want ? want.split(",").map((n) => `{${n}}`).join(" ") : "(none)"}, and it uses ${got ? got.split(",").map((n) => `{${n}}`).join(" ") : "none"}.`;
  const categories = new Set(new Intl.PluralRules(locale).resolvedOptions().pluralCategories);
  const wanted = shapeOf(sourceNodes);
  const found = shapeOf(nodes);
  for (const s of wanted) {
    const same = found.filter((f) => f.arg === s.arg && f.kind === s.kind);
    if (same.length === 0) return `It must choose on {${s.arg}} (${s.kind}) as the original does.`;
    if (s.kind === "select") {
      for (const f of same) {
        for (const name of s.names) if (!f.names.includes(name)) return `Its select on {${s.arg}} must have the option "${name}".`;
      }
    }
  }
  for (const f of found) {
    if (f.kind !== "plural") continue;
    for (const name of f.names) {
      if (!name.startsWith("=") && name !== "other" && !categories.has(name as Intl.LDMLPluralRule)) {
        return `"${name}" is not a plural form of this language.`;
      }
    }
  }
  return null;
}

/** The plural forms a language writes, for the instructions to the model: `one`, `few`, `many`, `other`. */
export function pluralForms(locale: string): string[] {
  return new Intl.PluralRules(locale).resolvedOptions().pluralCategories as string[];
}

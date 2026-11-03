/**
 * Code in the docs, coloured (wave 14 unit E2, D442): a small tokenizer for the languages the docs show (shell and curl, JSON, JavaScript
 * and TypeScript, Python, PHP, HTTP, YAML), run once when the docs are built. The installed `@lezer` grammars cover CSS alone, and a code
 * sample needs strings, numbers, keywords, comments and keys told apart, not a parse. Pure; its output is text with a tag per piece, drawn
 * as `<span>`s by React (escaped), never as HTML.
 */

export type CodeTag = "comment" | "string" | "number" | "keyword" | "property" | "literal" | "punctuation";

/** A piece of code: its text, and its tag (null for plain text, spaces and new lines among it). */
export type CodeToken = { tag: CodeTag | null; text: string };

type Grammar = {
  /** Patterns tried in order at each position, each anchored there (`y`); the first that matches wins. */
  rules: { tag: CodeTag | null; pattern: RegExp }[];
};

const word = (words: string[]) => new RegExp(`(?:${words.join("|")})\\b`, "y");

const NUMBER = /-?(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/iy;
const DQ = /"(?:[^"\\\n]|\\.)*"?/y;
const SQ = /'(?:[^'\\\n]|\\.)*'?/y;
const BQ = /`(?:[^`\\]|\\.)*`?/y;
const PUNCT = /[{}[\](),;:.=<>+\-*/%!&|?^~]+/y;
const IDENT = /[A-Za-z_$][\w$]*/y;
const SPACE = /\s+/y;

const JS_KEYWORDS = ["const", "let", "var", "function", "return", "if", "else", "for", "while", "of", "in", "new", "await", "async", "import", "from", "export", "default", "class", "extends", "try", "catch", "throw", "typeof", "type", "interface", "as"];
const PY_KEYWORDS = ["def", "return", "if", "elif", "else", "for", "while", "in", "import", "from", "as", "with", "try", "except", "raise", "class", "lambda", "not", "and", "or", "is", "pass", "async", "await"];
const PHP_KEYWORDS = ["function", "return", "if", "else", "elseif", "foreach", "as", "echo", "new", "use", "namespace", "class", "public", "private", "try", "catch", "throw", "fn"];

const GRAMMARS: Record<string, Grammar> = {
  javascript: {
    rules: [
      { tag: "comment", pattern: /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y },
      { tag: "property", pattern: /(?:"(?:[^"\\\n]|\\.)*"|[A-Za-z_$][\w$]*)(?=\s*:(?!:))/y },
      { tag: "string", pattern: DQ },
      { tag: "string", pattern: SQ },
      { tag: "string", pattern: BQ },
      { tag: "literal", pattern: word(["true", "false", "null", "undefined"]) },
      { tag: "keyword", pattern: word(JS_KEYWORDS) },
      { tag: "number", pattern: NUMBER },
      { tag: null, pattern: IDENT },
      { tag: "punctuation", pattern: PUNCT },
    ],
  },
  json: {
    rules: [
      { tag: "property", pattern: /"(?:[^"\\\n]|\\.)*"(?=\s*:)/y },
      { tag: "string", pattern: DQ },
      { tag: "literal", pattern: word(["true", "false", "null"]) },
      { tag: "number", pattern: NUMBER },
      { tag: "punctuation", pattern: /[{}[\],:]/y },
    ],
  },
  shell: {
    rules: [
      { tag: "comment", pattern: /(?<![^\s])#[^\n]*/y },
      { tag: "string", pattern: DQ },
      { tag: "string", pattern: SQ },
      { tag: "keyword", pattern: /(?:curl|export|echo|if|then|fi|for|do|done|npm|pnpm|npx|node)\b/y },
      { tag: "property", pattern: /--?[A-Za-z][\w-]*/y },
      { tag: "literal", pattern: /\$\{?[A-Za-z_]\w*\}?/y },
      { tag: null, pattern: /[^\s"'#$\\]+/y },
      { tag: "punctuation", pattern: /\\/y },
    ],
  },
  python: {
    rules: [
      { tag: "comment", pattern: /#[^\n]*/y },
      { tag: "string", pattern: /[rbf]?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$))/iy },
      { tag: "string", pattern: /[rbf]?"(?:[^"\\\n]|\\.)*"?/iy },
      { tag: "string", pattern: /[rbf]?'(?:[^'\\\n]|\\.)*'?/iy },
      { tag: "literal", pattern: word(["True", "False", "None"]) },
      { tag: "keyword", pattern: word(PY_KEYWORDS) },
      { tag: "number", pattern: NUMBER },
      { tag: null, pattern: IDENT },
      { tag: "punctuation", pattern: PUNCT },
    ],
  },
  php: {
    rules: [
      { tag: "comment", pattern: /\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y },
      { tag: "string", pattern: DQ },
      { tag: "string", pattern: SQ },
      { tag: "literal", pattern: /\$[A-Za-z_]\w*|(?:true|false|null)\b/iy },
      { tag: "keyword", pattern: word(PHP_KEYWORDS) },
      { tag: "number", pattern: NUMBER },
      { tag: null, pattern: IDENT },
      { tag: "punctuation", pattern: PUNCT },
    ],
  },
  http: {
    rules: [
      { tag: "keyword", pattern: /(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/y },
      { tag: "property", pattern: /(?<=^|\n)[A-Za-z][\w-]*(?=:)/y },
      { tag: "string", pattern: DQ },
      { tag: "number", pattern: NUMBER },
      { tag: null, pattern: /[^\s"]+/y },
    ],
  },
  yaml: {
    rules: [
      { tag: "comment", pattern: /(?<![^\s])#[^\n]*/y },
      { tag: "property", pattern: /[A-Za-z_][\w-]*(?=:(?:\s|$))/y },
      { tag: "string", pattern: DQ },
      { tag: "string", pattern: SQ },
      { tag: "literal", pattern: word(["true", "false", "null"]) },
      { tag: "number", pattern: NUMBER },
      { tag: null, pattern: /[^\s"'#]+/y },
    ],
  },
};

/** The languages a fence may name, and the grammar each is read with. */
const ALIASES: Record<string, keyof typeof GRAMMARS> = {
  js: "javascript",
  javascript: "javascript",
  mjs: "javascript",
  jsx: "javascript",
  ts: "javascript",
  typescript: "javascript",
  tsx: "javascript",
  json: "json",
  bash: "shell",
  sh: "shell",
  shell: "shell",
  curl: "shell",
  console: "shell",
  python: "python",
  py: "python",
  php: "php",
  http: "http",
  yaml: "yaml",
  yml: "yaml",
};

/** Languages shown as they are, without colour. */
const PLAIN = new Set(["", "text", "txt", "plain", "markdown", "md"]);

/** Whether a fence's language is one the docs know (coloured or plain). */
export function knownCodeLanguage(lang: string): boolean {
  const name = lang.toLowerCase();
  return PLAIN.has(name) || Object.hasOwn(ALIASES, name);
}

/** The code as tagged pieces, in order; together they are the code exactly. A language the docs do not colour is one plain piece. */
export function highlightCode(code: string, lang: string | null): CodeToken[] {
  const grammar = GRAMMARS[ALIASES[(lang ?? "").toLowerCase()] ?? ""];
  if (!grammar) return code === "" ? [] : [{ tag: null, text: code }];
  const tokens: CodeToken[] = [];
  const push = (tag: CodeTag | null, text: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.tag === tag) last.text += text;
    else tokens.push({ tag, text });
  };
  let i = 0;
  while (i < code.length) {
    SPACE.lastIndex = i;
    const space = SPACE.exec(code);
    if (space) {
      push(null, space[0]);
      i += space[0].length;
      continue;
    }
    let matched = false;
    for (const { tag, pattern } of grammar.rules) {
      pattern.lastIndex = i;
      const match = pattern.exec(code);
      if (match && match[0].length > 0) {
        push(tag, match[0]);
        i += match[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      push(null, code[i]);
      i += 1;
    }
  }
  return tokens;
}

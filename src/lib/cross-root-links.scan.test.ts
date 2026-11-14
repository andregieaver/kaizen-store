import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A link that crosses to another root layout is a full page load on press, so a prefetch buys nothing and pulls the other surface's scripts and stylesheet (bloat review step 0.12).
 * This reads every .tsx file under src as text and fails, naming file and line, on a `<Link` to /admin outside the admin, on the signed-out admin pages' links back to the site, and on
 * a language or currency link in the view menu, when its tag lacks `prefetch={false}`.
 */
const ROOT = process.cwd();
const SIGNED_OUT_ADMIN = ["src/app/admin/sign-in/page.tsx", "src/components/admin/ui/focus-frame.tsx"];
const VIEW_MENU = "src/components/view-menu.tsx";

/** Each `<Link` opening tag: its line and its text, up to the `>` that closes it (not one inside braces, such as an arrow function's, or inside a string). */
function linkTags(text: string): { line: number; tag: string }[] {
  const tags: { line: number; tag: string }[] = [];
  const start = /<Link(?=[\s>/])/g;
  for (let m = start.exec(text); m; m = start.exec(text)) {
    let depth = 0;
    let quote: string | null = null;
    let end = text.length;
    for (let i = m.index + 5; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        end = i + 1;
        break;
      }
    }
    tags.push({ line: text.slice(0, m.index).split("\n").length, tag: text.slice(m.index, end) });
  }
  return tags;
}

/** The `file:line` of each link in `text` that the rules say must carry `prefetch={false}` and does not. */
function offenders(file: string, text: string): string[] {
  const inAdmin = file.startsWith("src/app/admin/") || file.startsWith("src/components/admin/");
  return linkTags(text)
    .filter(({ tag }) => {
      if (/\bprefetch=\{false\}/.test(tag)) return false;
      if (file === VIEW_MENU) return true;
      if (!inAdmin && /\bhref="\/admin(?:[/?#][^"]*)?"/.test(tag)) return true;
      return SIGNED_OUT_ADMIN.includes(file) && /\bhref="(?:\/|\/sign-up)"/.test(tag);
    })
    .map(({ line }) => `${file}:${line}`);
}

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(join(ROOT, path)).isDirectory()) return sources(path);
    return name.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(name) ? [path] : [];
  });
}

describe("links that cross to another root layout are not prefetched", () => {
  it("every one carries prefetch={false}", () => {
    const found = sources("src").flatMap((file) => offenders(file, readFileSync(join(ROOT, file), "utf8")));
    expect(found).toEqual([]);
  });

  it("notices a link to /admin outside the admin without it", () => {
    expect(offenders("src/components/x.tsx", `<Link href="/admin" className="x">`)).toEqual(["src/components/x.tsx:1"]);
    expect(offenders("src/components/x.tsx", `<Link href="/admin" prefetch={false}>`)).toEqual([]);
  });

  it("reads a tag spread over lines, with an arrow function in a prop", () => {
    const text = `<div>\n  <Link\n    href="/admin"\n    onClick={(event) => {\n      go(event);\n    }}\n    className="x"\n  >\n    Admin\n  </Link>\n</div>`;
    expect(offenders("src/components/x.tsx", text)).toEqual(["src/components/x.tsx:2"]);
    expect(offenders("src/components/x.tsx", text.replace('href="/admin"', 'href="/admin"\n    prefetch={false}'))).toEqual([]);
  });

  it("leaves the admin's own links and other links alone, and holds the signed-out pages and the view menu", () => {
    expect(offenders("src/app/admin/x.tsx", `<Link href="/admin/orders">`)).toEqual([]);
    expect(offenders("src/components/x.tsx", `<Link href="/sign-up">`)).toEqual([]);
    expect(offenders(SIGNED_OUT_ADMIN[0], `<Link href="/sign-up">`)).toHaveLength(1);
    expect(offenders(SIGNED_OUT_ADMIN[1], `<Link href="/">`)).toHaveLength(1);
    expect(offenders(SIGNED_OUT_ADMIN[1], `<Link href={back.href}>`)).toEqual([]);
    expect(offenders(VIEW_MENU, `<Link href={item.base}>`)).toHaveLength(1);
  });
});

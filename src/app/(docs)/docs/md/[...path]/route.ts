import { docPage, docsPaths, docsTree, DOCS_CHANGELOG_PATH, type DocLang } from "@/lib/docs-content";
import { docsUrl } from "@/lib/docs-host";
import { platformText } from "@/lib/platform-text";
import { changelogMarkdown, docPageMarkdown } from "@/lib/docs-text";
import { docsIndex } from "@/server/docs";

/**
 * Each docs page as plain Markdown (D442), for AI tools and for people who want the source: asked for at the page's own address plus `.md`
 * (`/docs/owners/…/page.md`, `/no/docs/…/page.md`, the same on the docs' host), which a rewrite sends here (`docsHostRoutes()`), Norwegian
 * under `no/`. Prerendered; its `Link` header names the page as the canonical address.
 */
export function generateStaticParams(): { path: string[] }[] {
  const index = docsIndex();
  const pages = (lang: DocLang) => docsPaths(index, lang).filter((path) => index.pages.some((p) => p.path === path && p.lang === lang) || (lang === "en" && path === DOCS_CHANGELOG_PATH));
  return [...pages("en").map((path) => ({ path: path.split("/") })), ...pages("nb").map((path) => ({ path: ["no", ...path.split("/")] }))];
}

const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(_request: Request, { params }: RouteContext<"/docs/md/[...path]">) {
  const segments = (await params).path;
  const lang: DocLang = segments[0] === "no" ? "nb" : "en";
  const path = (lang === "nb" ? segments.slice(1) : segments).join("/");
  const index = docsIndex();
  let body: string | null = null;
  if (lang === "en" && path === DOCS_CHANGELOG_PATH && index.changelog) body = changelogMarkdown(index.changelog, index, platformText("en").docs.changelog);
  else {
    const page = docPage(index, path, lang);
    // Only a page the docs draw (its section has its title in the language), as its HTML address answers.
    if (page && docsTree(index, page.track, lang).some((entry) => entry.pages.includes(page))) body = docPageMarkdown(page, index);
  }
  if (body === null) return notFound();
  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", Link: `<${docsUrl(path, lang)}>; rel="canonical"` },
  });
}

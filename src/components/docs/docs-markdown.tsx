import type { ReactNode } from "react";

import { docLinkLang, type DocLang, type DocsIndex } from "@/lib/docs-content";
import type { CodeTag } from "@/lib/docs-highlight";
import { docsPath, docsSiteHref } from "@/lib/docs-host";
import type { Block, CalloutTone, DocHref, Inline } from "@/lib/docs-markdown";

/** What a docs page's Markdown is drawn with: the index (for the language of a link's target) and the callouts' words. */
export type DocsMarkdownContext = { index: DocsIndex; lang: DocLang; callouts: Record<CalloutTone, string> };

/**
 * A link's address as the page links it: another docs page on whichever host serves the docs (in the page's language where the target has
 * it), a heading of the page, Kaizena Flow's site (full while the docs have their own host), the admin (its front door: the store's admin
 * opens from there, the address in the article is the admin map's) or another site.
 */
export function docHrefOf(href: DocHref, index: DocsIndex, lang: DocLang): string {
  switch (href.kind) {
    case "doc":
      return `${docsPath(href.path, docLinkLang(index, href.path, lang))}${href.anchor ? `#${href.anchor}` : ""}`;
    case "anchor":
      return `#${href.id}`;
    case "site":
      return docsSiteHref(href.path);
    case "admin":
      return docsSiteHref("/admin");
    case "external":
      return href.url;
  }
}

/** Colours for code, each readable on the code block's background in light and dark. */
const TOKEN: Record<CodeTag, string> = {
  comment: "text-[#57606a] dark:text-[#9da7b3]",
  string: "text-[#0a3069] dark:text-[#a5d6ff]",
  number: "text-[#953800] dark:text-[#ffa657]",
  literal: "text-[#953800] dark:text-[#ffa657]",
  keyword: "text-[#a40e26] dark:text-[#ff7b72]",
  property: "text-[#0550ae] dark:text-[#79c0ff]",
  punctuation: "",
};

const CALLOUT: Record<CalloutTone, string> = {
  note: "border-[#0969da] dark:border-[#4493f8]",
  tip: "border-[#1a7f37] dark:border-[#3fb950]",
  important: "border-[#8250df] dark:border-[#ab7df8]",
  warning: "border-[#9a6700] dark:border-[#d29922]",
  caution: "border-[#cf222e] dark:border-[#f85149]",
};

const LINK = "underline underline-offset-2 hover:no-underline";

function Inlines({ nodes, ctx }: { nodes: readonly Inline[]; ctx: DocsMarkdownContext }): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.value;
      case "strong":
        return (
          <strong key={i} className="font-semibold">
            <Inlines nodes={node.children} ctx={ctx} />
          </strong>
        );
      case "em":
        return (
          <em key={i}>
            <Inlines nodes={node.children} ctx={ctx} />
          </em>
        );
      case "code":
        return (
          <code key={i} className="rounded bg-surface px-1 py-0.5 font-mono text-[0.9em] break-words">
            {node.value}
          </code>
        );
      case "break":
        return <br key={i} />;
      case "link": {
        const external = node.href.kind === "external";
        return (
          <a key={i} href={docHrefOf(node.href, ctx.index, ctx.lang)} className={LINK} {...(external && { rel: "noopener noreferrer" })} {...(node.href.kind === "admin" && { "data-admin-path": node.href.path })}>
            <Inlines nodes={node.children} ctx={ctx} />
          </a>
        );
      }
    }
  });
}

const HEADING = {
  2: "mt-10 scroll-mt-20 text-2xl font-semibold tracking-tight",
  3: "mt-8 scroll-mt-20 text-xl font-semibold",
  4: "mt-6 scroll-mt-20 text-lg font-semibold",
} as const;

function BlockView({ block, ctx }: { block: Block; ctx: DocsMarkdownContext }): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = `h${block.depth}` as "h2" | "h3" | "h4";
      return (
        <Tag id={block.id} className={HEADING[block.depth]}>
          <Inlines nodes={block.children} ctx={ctx} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="mt-4 leading-7">
          <Inlines nodes={block.children} ctx={ctx} />
        </p>
      );
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i} className="pl-1 leading-7 [&>p:first-child]:mt-0 [&>p]:mt-2">
          <Blocks blocks={item} ctx={ctx} />
        </li>
      ));
      return block.ordered ? (
        <ol start={block.start === 1 ? undefined : block.start} className="mt-4 list-decimal space-y-2 pl-6">
          {items}
        </ol>
      ) : (
        <ul className="mt-4 list-disc space-y-2 pl-6">{items}</ul>
      );
    }
    case "code":
      return (
        // Focusable, so a reader on a keyboard can scroll a long line.
        <pre tabIndex={0} className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-sm leading-6 focus-visible:outline-2 focus-visible:outline-offset-2 print:whitespace-pre-wrap" data-lang={block.lang ?? undefined}>
          <code>
            {block.tokens.map((token, i) =>
              token.tag && TOKEN[token.tag] ? (
                <span key={i} className={TOKEN[token.tag]}>
                  {token.text}
                </span>
              ) : (
                token.text
              ),
            )}
          </code>
        </pre>
      );
    case "table":
      return (
        <div tabIndex={0} className="mt-4 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                {block.head.map((cell, c) => (
                  <th key={c} scope="col" className="px-3 py-2 align-bottom font-semibold" style={block.align[c] ? { textAlign: block.align[c] } : undefined}>
                    <Inlines nodes={cell} ctx={ctx} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b border-border">
                  {row.map((cell, c) => (
                    <td key={c} className="px-3 py-2 align-top" style={block.align[c] ? { textAlign: block.align[c] } : undefined}>
                      <Inlines nodes={cell} ctx={ctx} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "callout":
      return (
        <div role="note" className={`mt-4 rounded-r-lg border-l-4 bg-surface px-4 py-3 ${CALLOUT[block.tone]} [&>*:nth-child(2)]:mt-1`}>
          <p className="font-semibold">{ctx.callouts[block.tone]}</p>
          <Blocks blocks={block.children} ctx={ctx} />
        </div>
      );
    case "quote":
      return (
        <blockquote className="mt-4 border-l-4 border-border pl-4 text-muted [&>p:first-child]:mt-0">
          <Blocks blocks={block.children} ctx={ctx} />
        </blockquote>
      );
    case "image":
      return (
        // eslint-disable-next-line @next/next/no-img-element -- a picture from the repository (`public/kaizen/docs/`), served on every host
        <img src={block.src} alt={block.alt} loading="lazy" decoding="async" className="mt-4 max-w-full rounded-lg border border-border" />
      );
    case "rule":
      return <hr className="mt-8 border-border" />;
  }
}

function Blocks({ blocks, ctx }: { blocks: readonly Block[]; ctx: DocsMarkdownContext }): ReactNode {
  return blocks.map((block, i) => <BlockView key={i} block={block} ctx={ctx} />);
}

/** An article's body as React elements: every text escaped by React, every address one `classifyHref()` let through. */
export function DocsMarkdown({ blocks, ctx }: { blocks: readonly Block[]; ctx: DocsMarkdownContext }) {
  return (
    <div className="[&>*:first-child]:mt-0">
      <Blocks blocks={blocks} ctx={ctx} />
    </div>
  );
}

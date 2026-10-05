import { createElement, type ReactNode } from "react";

import { hasInline, parseInline, type InlineNode } from "@/lib/inline-text";

/**
 * A page builder text with the inline markup an owner may write (`parseInline()`):
 * a class on a span, bold, a line break… drawn as React elements, never as HTML. Anything
 * else stays the text that was typed. `links` allows `<a>`; leave it off inside a link,
 * a button or a summary, where a link may not be.
 */
export function Inline({ text, links = false }: { text: string; links?: boolean }): ReactNode {
  if (!hasInline(text)) return text;
  return draw(parseInline(text), links);
}

function draw(nodes: InlineNode[], links: boolean): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.type === "text") return node.text;
    if (node.type === "br") return <br key={index} />;
    const children = draw(node.children, links);
    // A link is only its words where links are not allowed.
    if (node.tag === "a" && !links) return <span key={index}>{children}</span>;
    return createElement(
      node.tag,
      {
        key: index,
        className: node.className,
        ...(node.tag === "a" && { href: node.href, ...(/^https?:/i.test(node.href ?? "") && { rel: "noopener noreferrer" }) }),
      },
      children,
    );
  });
}

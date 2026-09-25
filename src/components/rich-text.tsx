import Link from "next/link";
import type { ReactNode } from "react";

import type { BlockNode, InlineNode, Mark, RichTextDoc } from "@/lib/page-content";

/**
 * A rich-text block as React elements (D42): the stored document is
 * walked node by node, so only the elements Kaizen knows are made and no
 * stored text is ever read as HTML.
 */
export function RichText({ doc }: { doc: RichTextDoc }) {
  return <div className="rich-text">{trimmed(doc.content).map(block)}</div>;
}

const isEmpty = (node: BlockNode) => node.type === "paragraph" && !node.content?.length;

/** Whether a block shows anything; empty ones are left out of the page. */
export const hasContent = (doc: RichTextDoc) => !doc.content.every(isEmpty);

/** Without the empty paragraphs the editor keeps at the start and end of a block (to type after a list). */
function trimmed(nodes: BlockNode[]): BlockNode[] {
  let start = 0;
  let end = nodes.length;
  while (start < end && isEmpty(nodes[start])) start++;
  while (end > start && isEmpty(nodes[end - 1])) end--;
  return nodes.slice(start, end);
}

function block(node: BlockNode, index: number): ReactNode {
  switch (node.type) {
    case "paragraph":
      return <p key={index}>{inline(node.content)}</p>;
    case "heading": {
      const Tag = `h${node.attrs.level}` as "h2" | "h3" | "h4";
      return <Tag key={index}>{inline(node.content)}</Tag>;
    }
    case "bulletList":
      return (
        <ul key={index}>
          {node.content.map((item, i) => (
            <li key={i}>{item.content.map(block)}</li>
          ))}
        </ul>
      );
    case "orderedList":
      return (
        <ol key={index} start={node.attrs?.start}>
          {node.content.map((item, i) => (
            <li key={i}>{item.content.map(block)}</li>
          ))}
        </ol>
      );
    case "blockquote":
      return <blockquote key={index}>{node.content.map(block)}</blockquote>;
    case "horizontalRule":
      return <hr key={index} />;
  }
}

function inline(nodes: InlineNode[] = []): ReactNode {
  // An empty paragraph keeps its line, as it did in the editor.
  if (nodes.length === 0) return <br />;
  return nodes.map((node, index) => (node.type === "hardBreak" ? <br key={index} /> : marked(node.text, node.marks ?? [], index)));
}

/** Text wrapped in its marks; a link goes outermost. */
function marked(text: string, marks: Mark[], key: number): ReactNode {
  let out: ReactNode = text;
  for (const mark of marks) {
    if (mark.type === "bold") out = <strong>{out}</strong>;
    else if (mark.type === "italic") out = <em>{out}</em>;
    else if (mark.type === "underline") out = <u>{out}</u>;
  }
  const link = marks.find((mark) => mark.type === "link");
  if (link) {
    const href = link.attrs.href;
    out = href.startsWith("/") ? (
      <Link href={href}>{out}</Link>
    ) : (
      <a href={href} {...(/^https?:/.test(href) && { rel: "noopener" })}>
        {out}
      </a>
    );
  }
  return <span key={key}>{out}</span>;
}

import Link from "next/link";

import { Icon } from "./icons";

/** A menu's link as the site draws it, with the links under it (D85). */
export type MenuLinkNode = {
  key: string;
  href: string;
  text: string;
  external: boolean;
  newTab: boolean;
  children: MenuLinkNode[];
};

/**
 * How a menu is laid out: side by side, with the links under a link in a
 * list that opens below it on hover or focus (`row`); one under another,
 * the links under a link indented beneath it (`column`); or the phone's
 * slide-out menu (`drawer`), as a column with larger targets.
 */
export type MenuLayout = "row" | "column" | "drawer";

const SUB_LINK = "flex min-h-10 items-center rounded-md px-3 text-sm hover:bg-surface";

/** A menu's links, nested as the owner placed them. Needs no script: lists under a link open on hover or keyboard focus. */
export function MenuTreeView({
  nodes,
  layout,
  linkClassName,
  newTabLabel,
  justify = "",
}: {
  nodes: MenuLinkNode[];
  layout: MenuLayout;
  /** The top links' look; the links under them take the menu's own. */
  linkClassName: string;
  /** Read out after a link that opens a new tab, in the page's language. */
  newTabLabel: string;
  /** Where side-by-side links sit along the line (`justify-*` classes). */
  justify?: string;
}) {
  if (nodes.length === 0) return null;
  const anchor = (node: MenuLinkNode, className: string, chevron = false) => {
    const body = (
      <>
        {node.text}
        {chevron && <Icon name="chevron" className="size-3.5 shrink-0 opacity-70" />}
        {node.newTab && <span className="sr-only"> {newTabLabel}</span>}
      </>
    );
    const newTab = node.newTab ? { target: "_blank", rel: "noopener noreferrer" } : node.external ? { rel: "noopener" } : {};
    return node.external || node.newTab ? (
      <a href={node.href} className={className} {...newTab}>
        {body}
      </a>
    ) : (
      <Link href={node.href} className={className}>
        {body}
      </Link>
    );
  };

  if (layout === "row") {
    // The links under a link, one list below it; deeper ones indented in it.
    const dropdown = (children: MenuLinkNode[], depth = 1) => (
      <ul className={depth === 1 ? "flex flex-col" : "flex flex-col pl-3"}>
        {children.map((child) => (
          <li key={child.key}>
            {anchor(child, SUB_LINK)}
            {child.children.length > 0 && dropdown(child.children, depth + 1)}
          </li>
        ))}
      </ul>
    );
    return (
      <ul className={`flex flex-wrap items-center gap-1 ${justify}`}>
        {nodes.map((node) => (
          <li key={node.key} className="group/menu relative">
            {anchor(node, `${linkClassName} gap-1`, node.children.length > 0)}
            {node.children.length > 0 && (
              // `pt-1` bridges the gap, so the list stays open on the way down to it.
              <div className="invisible absolute top-full left-0 z-40 min-w-52 pt-1 opacity-0 transition-opacity group-focus-within/menu:visible group-focus-within/menu:opacity-100 group-hover/menu:visible group-hover/menu:opacity-100 motion-reduce:transition-none">
                <div className="rounded-lg border border-border bg-background p-1 text-foreground shadow-lg">{dropdown(node.children)}</div>
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  }

  const list = (items: MenuLinkNode[], depth: number) => (
    <ul className={`flex flex-col ${layout === "column" ? "gap-1" : ""} ${depth > 0 ? "pl-4" : ""}`}>
      {items.map((node) => (
        <li key={node.key}>
          {anchor(node, depth > 0 && layout === "drawer" ? "flex min-h-11 items-center text-base" : linkClassName)}
          {node.children.length > 0 && list(node.children, depth + 1)}
        </li>
      ))}
    </ul>
  );
  return list(nodes, 0);
}

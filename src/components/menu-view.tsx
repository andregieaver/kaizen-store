import Image from "next/image";
import Link from "next/link";

import type { MegaMenu, MenuPicture } from "@/lib/navigation";

import { Icon } from "./icons";

/** A menu's link as the site draws it, with the links under it (D85). */
export type MenuLinkNode = {
  key: string;
  href: string;
  text: string;
  external: boolean;
  newTab: boolean;
  /** A top link's mega menu (D87). */
  mega?: MegaMenu;
  /** Shown above the link in a mega menu (D87). */
  image?: MenuPicture;
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
  const anchor = (node: MenuLinkNode, className: string, chevron = false, picture = false) => {
    const body = (
      <>
        {picture && node.image && (
          <Image
            src={node.image.url}
            alt=""
            width={node.image.width}
            height={node.image.height}
            unoptimized
            className="aspect-[4/3] w-full rounded-lg bg-surface object-cover"
          />
        )}
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
    /**
     * A mega menu (D87): the links under a top link side by side in columns
     * across the width of the header (or the row the menu is in), each with
     * its picture and the links under it; centred if asked.
     */
    const mega = (node: MenuLinkNode, mega: MegaMenu) => {
      const columns = Math.max(1, mega.columns);
      return (
        <li key={node.key} className="group/menu" data-mega-menu>
          {/* The link reaches down to the panel's edge, so the panel stays open on the way to it. */}
          {anchor(node, `${linkClassName} relative gap-1 after:absolute after:inset-x-0 after:top-full after:h-5`, true)}
          <div className="invisible absolute inset-x-0 top-full z-40 opacity-0 transition-opacity group-focus-within/menu:visible group-focus-within/menu:opacity-100 group-hover/menu:visible group-hover/menu:opacity-100 motion-reduce:transition-none">
            <div className="border-y border-border bg-background text-foreground shadow-lg">
              <ul
                className={`mx-auto flex max-w-[var(--content-width,64rem)] flex-wrap gap-6 px-4 py-6 ${mega.center ? "justify-center text-center" : ""}`}
              >
                {node.children.map((child) => (
                  <li
                    key={child.key}
                    className="flex min-w-0 flex-col gap-2"
                    style={{ width: `calc((100% - ${columns - 1} * 1.5rem) / ${columns})` }}
                  >
                    {anchor(child, `flex flex-col gap-2 font-medium hover:underline ${mega.center ? "items-center" : ""}`, false, true)}
                    {child.children.length > 0 && (
                      <ul className="flex flex-col gap-1 text-sm">
                        {child.children.map((grandchild) => (
                          <li key={grandchild.key}>{anchor(grandchild, "inline-flex min-h-8 items-center text-muted hover:text-foreground hover:underline")}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </li>
      );
    };
    return (
      <ul className={`flex flex-wrap items-center gap-1 ${justify}`}>
        {nodes.map((node) => node.mega && node.children.length > 0 ? mega(node, node.mega) : (
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

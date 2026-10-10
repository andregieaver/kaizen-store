import { iconItemShows, type IconListBlock } from "@/lib/page-content";
import type { ButtonSize } from "@/lib/page-content";

import { ListIcon } from "./list-icon";
import { Inline } from "@/components/inline-text";

// Written out whole so Tailwind finds every class.
const ICON: Record<ButtonSize, string> = { sm: "size-4", md: "size-5", lg: "size-7" };
const JUSTIFY = { left: "justify-start", center: "justify-center", right: "justify-end" } as const;

/** An icon list (D91): its lines with words, each after its icon, a link where it has an address. */
export function IconListView({ block }: { block: IconListBlock }) {
  const size = ICON[block.iconSize ?? "md"];
  const row = block.layout === "row";
  // Lines side by side, or icons taller than the text, sit on the middle; long lines under one another start with their first line.
  const align = row || block.iconSize === "lg" ? "items-center" : "items-start";
  return (
    <ul
      className={row ? `flex flex-wrap items-center ${JUSTIFY[block.position ?? "left"]}` : "flex flex-col"}
      style={{ gap: row ? `${block.gap ?? 12}px ${(block.gap ?? 12) * 2}px` : `${block.gap ?? 12}px` }}
    >
      {block.items.filter(iconItemShows).map((item) => {
        const line = (
          <>
            <ListIcon
              name={item.icon}
              className={`shrink-0 ${align === "items-start" ? "mt-[0.15em]" : ""} ${size} ${block.iconColor || block.iconGradient ? "" : "text-accent"}`}
              {...(block.iconColor && { style: { color: block.iconColor } })}
              {...(block.iconGradient && { gradient: block.iconGradient })}
            />
            <span>
              <Inline text={item.text} links={!item.href} />
            </span>
          </>
        );
        return (
          <li key={item.id} className={`flex ${align} gap-2.5`}>
            {item.href ? (
              <a href={item.href} className={`flex ${align} gap-2.5 hover:underline`}>
                {line}
              </a>
            ) : (
              line
            )}
          </li>
        );
      })}
    </ul>
  );
}

import type { CSSProperties } from "react";

import type { ButtonSize, SocialLinksBlock, SocialShape } from "@/lib/page-content";
import { socialLinkShows } from "@/lib/page-content";
import { SOCIAL_NETWORKS, socialHref, textOn } from "@/lib/social-links";

import { BrandIcon, brandColor } from "./brand-icon";

// Written out whole so Tailwind finds every class.
const ICON: Record<ButtonSize, string> = { sm: "size-4", md: "size-5", lg: "size-7" };
const BOX: Record<ButtonSize, string> = { sm: "min-h-9 min-w-9", md: "min-h-11 min-w-11", lg: "min-h-14 min-w-14" };
const SHAPE: Record<SocialShape, string> = { circle: "rounded-full", rounded: "rounded-lg", square: "rounded-none" };
const JUSTIFY = { left: "justify-start", center: "justify-center", right: "justify-end" } as const;

/**
 * Social media buttons (D91): each link with its network's logo, named for
 * screen readers (and in words if set), opening the profile in a new tab
 * (`rel="me"`, so profiles that check it, such as Mastodon's, can confirm
 * the site). Links without an address that is one are left out.
 */
export function SocialLinksView({ block }: { block: SocialLinksBlock }) {
  const look = block.look ?? "plain";
  const size = block.size ?? "md";
  const shape = block.shape ?? "circle";
  const colors = block.colors ?? "brand";
  const named = Boolean(block.showNames);
  return (
    <ul className={`flex flex-wrap items-center ${JUSTIFY[block.position ?? "left"]}`} style={{ gap: `${block.gap ?? 12}px` }}>
      {block.links.filter(socialLinkShows).map((link) => {
        const href = socialHref(link.network, link.href)!;
        const name = SOCIAL_NETWORKS[link.network];
        // The colour: the network's own (or the text's for black marks), the site's primary, or one chosen.
        const own = colors === "custom" ? (block.color ?? null) : colors === "brand" ? brandColor(link.network) : null;
        const themed = colors === "theme";
        const style: CSSProperties =
          look === "filled"
            ? own
              ? { backgroundColor: own, color: own.startsWith("#") && own.length === 7 ? textOn(own) : "#ffffff" }
              : {}
            : own
              ? { color: own, ...(look === "outline" && { borderColor: own }) }
              : {};
        const filledPlain = look === "filled" && !own;
        const className = [
          "inline-flex items-center justify-center gap-2 transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2",
          look !== "plain" && `${BOX[size]} ${SHAPE[shape]} ${named ? "px-3" : ""}`,
          look === "outline" && "border-2 border-current",
          filledPlain && (themed ? "bg-accent text-accent-foreground" : "bg-foreground text-background"),
          look !== "filled" && themed && "text-accent",
        ]
          .filter(Boolean)
          .join(" ");
        const external = link.network !== "email" && link.network !== "phone";
        return (
          <li key={link.id}>
            <a
              href={href}
              {...(external && { target: "_blank", rel: "me noopener noreferrer" })}
              aria-label={named ? undefined : name}
              className={className}
              style={style}
            >
              <BrandIcon network={link.network} className={ICON[size]} />
              {named && <span className="text-sm font-medium">{name}</span>}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

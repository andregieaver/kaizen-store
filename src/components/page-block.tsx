import Image from "next/image";

import type { ImageShape, PageBlock } from "@/lib/page-content";

import { RichText } from "./rich-text";

/** Crops (D48), written out whole so Tailwind finds them. */
const SHAPES: Record<ImageShape, string> = {
  landscape: "aspect-[4/3] object-cover rounded-lg",
  portrait: "aspect-[3/4] object-cover rounded-lg",
  panorama: "aspect-[3/1] object-cover rounded-lg",
  square: "aspect-square object-cover rounded-lg",
  circle: "aspect-square object-cover rounded-full",
};

/**
 * One block as the site shows it (D42, D47): rich text, or a picture with
 * its caption, in its own shape or cropped to one (D48). The page builder's
 * canvas shows blocks with this too.
 */
export function PageBlockView({ block }: { block: PageBlock }) {
  if (block.type === "richText") return <RichText doc={block.doc} />;
  if (!block.image) return null;
  return (
    <figure className="flex flex-col gap-2">
      <Image
        src={block.image.url}
        alt={block.image.alt}
        width={block.image.width}
        height={block.image.height}
        unoptimized
        className={`h-auto w-full bg-surface ${block.shape ? SHAPES[block.shape] : "rounded-lg"}`}
      />
      {block.caption && <figcaption className="text-sm text-muted">{block.caption}</figcaption>}
    </figure>
  );
}

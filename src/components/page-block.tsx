import Image from "next/image";

import type { PageBlock } from "@/lib/page-content";

import { RichText } from "./rich-text";

/**
 * One block as the site shows it (D42, D47): rich text, or a picture with
 * its caption. The page builder's canvas shows blocks with this too.
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
        className="h-auto w-full rounded-lg bg-surface"
      />
      {block.caption && <figcaption className="text-sm text-muted">{block.caption}</figcaption>}
    </figure>
  );
}

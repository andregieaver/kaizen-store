import Image from "next/image";

import type { PageContent } from "@/lib/page-content";

import { hasContent, RichText } from "./rich-text";

/** A page's title, picture and blocks (D42): on the site, and in the admin's preview of a draft. */
export function PageArticle({ content }: { content: PageContent }) {
  return (
    <article className="flex flex-col gap-8">
      <h1 className="text-4xl font-semibold tracking-tight text-balance">{content.title}</h1>
      {content.thumbnail && (
        <Image
          src={content.thumbnail.url}
          alt={content.thumbnail.alt}
          width={content.thumbnail.width}
          height={content.thumbnail.height}
          unoptimized
          priority
          className="h-auto w-full rounded-lg bg-surface object-cover"
        />
      )}
      {content.blocks.filter((block) => hasContent(block.doc)).map((block) => (
        <RichText key={block.id} doc={block.doc} />
      ))}
    </article>
  );
}

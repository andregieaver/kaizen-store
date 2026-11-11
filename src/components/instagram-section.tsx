import type { CSSProperties } from "react";

import { snapAttribute } from "@/lib/carousel-settings";
import { t } from "@/lib/i18n";
import { captionText, feedPosts, type InstagramPost } from "@/lib/instagram";
import type { InstagramBlock } from "@/lib/page-content";
import { storeAndMarket, type GridPlace } from "@/server/content-grid";
import { instagramPosts } from "@/server/instagram";

import { Carousel } from "./carousel";

/** The gap between posts, in pixels. */
const GAP = 8;

/**
 * An Instagram feed on the site (D559): the owner's kept posts (a store's account, or Kaizena Flow's on its own pages), narrowed by the
 * block's hashtags, as a grid or a carousel of squares: `columns` across on larger screens (a grid's columns, a carousel's posts at a time),
 * `phoneColumns` on phones, `limit` in all. A picture links to its post on Instagram; a video plays in place when pressed (controls, never by
 * itself, nothing loaded before), or with `videos` off shows its cover linking to Instagram. Pictures and videos come through
 * `/api/instagram/…`, so the visitor's browser loads nothing from Meta. Captions are the owner's words, drawn as text. Nothing without an
 * account or a matching post.
 */
export async function InstagramSection({ block, place }: { block: InstagramBlock; place: GridPlace }) {
  const found = await instagramPosts(place.owner);
  if (!found) return null;
  const posts = feedPosts(found.posts, block.hashtags, block.match ?? "any", block.limit);
  if (posts.length === 0) return null;
  const lang = place.owner ? ((await storeAndMarket(place.owner, place.market ?? null))?.market.lang ?? "en") : (place.lang ?? "en");
  const m = t(lang);
  const base = `/api/instagram/${place.owner ?? "kaizen"}`;
  const profile = `https://www.instagram.com/${encodeURIComponent(found.username)}/`;
  const carousel = block.display === "carousel";
  const across = {
    "--ig-cols": block.columns,
    // Phones' count and larger screens' both by class: a `--cols` set inline here would win over the larger screens' rule.
    "--ig-phone": Math.min(block.phoneColumns ?? 2, block.columns),
    "--gap": `${GAP}px`,
    ...(carousel && block.peek && { "--peek": 0.25 }),
    gap: `${GAP}px`,
  } as CSSProperties;
  const list = (
    <ul
      aria-label={m.instagram.feed(found.username)}
      data-carousel-track={carousel ? "" : undefined}
      data-snap={carousel ? snapAttribute(block.carousel) : undefined}
      className={`[--cols:var(--ig-phone)] md:[--cols:var(--ig-cols)] ${carousel ? "" : "grid grid-cols-[repeat(var(--cols),minmax(0,1fr))]"}`}
      style={across}
    >
      {posts.map((post) => (
        <Post key={post.id} post={post} base={base} m={m} captions={block.captions === true} videos={block.videos !== false} />
      ))}
    </ul>
  );
  return (
    <div className="flex flex-col gap-4" data-instagram-feed="" data-display={carousel ? "carousel" : "grid"}>
      {carousel ? <Carousel settings={block.carousel}>{list}</Carousel> : list}
      {block.follow !== false && (
        <a href={profile} target="_blank" rel="noopener noreferrer" className="self-start text-sm font-medium underline">
          {m.instagram.follow(found.username)}
        </a>
      )}
    </div>
  );
}

function Post({ post, base, m, captions, videos }: { post: InstagramPost; base: string; m: ReturnType<typeof t>; captions: boolean; videos: boolean }) {
  const words = captionText(post.caption);
  const name = words.slice(0, 150) || (post.kind === "video" ? m.instagram.video : m.instagram.post);
  const square = "aspect-square w-full rounded-md bg-surface object-cover";
  return (
    <li className="flex min-w-0 flex-col gap-1.5">
      {post.kind === "video" && post.video && videos ? (
        // Plays only when pressed, without sound until turned on; nothing of it is loaded before (`preload="none"`).
        <video src={`${base}/${post.id}?video`} poster={`${base}/${post.id}`} controls muted playsInline preload="none" aria-label={name} className={square} />
      ) : (
        <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="group relative block overflow-hidden rounded-md focus-visible:outline-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- served by the site's own proxy at Instagram's size */}
          <img
            src={`${base}/${post.id}`}
            alt={name}
            width={640}
            height={640}
            loading="lazy"
            className={`${square} transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none`}
          />
          {post.kind === "video" && (
            <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-black/55 text-white">
                <svg viewBox="0 0 24 24" className="ml-0.5 size-5" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </span>
          )}
          <span className="sr-only"> {m.instagram.opens}</span>
        </a>
      )}
      {captions && words && (
        <p className="text-sm text-muted" style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden" }}>
          {words}
        </p>
      )}
    </li>
  );
}

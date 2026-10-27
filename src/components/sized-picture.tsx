import Image from "next/image";

import { pictureSources } from "@/lib/picture-sizes";

/**
 * A picture at the visitor's device size (D336): with the library's small copy, both files by width (`srcset`) and the browser picks
 * the one the screen needs from `sizes`; without one, the picture as it always was (`next/image`, unoptimised). Never resized on the
 * server.
 */
export function SizedPicture({
  url,
  small,
  width,
  height,
  sourceWidth,
  sizes,
  alt,
  className,
  loading,
  fetchPriority,
  priority = false,
  draggable,
}: {
  url: string;
  /** The library's 480 px copy, when it has one. */
  small?: string | null;
  /** The width and height it is drawn at (its shape). */
  width: number;
  height: number;
  /** The large file's own width, when known (else the most a picture is kept at). */
  sourceWidth?: number | null;
  sizes: string;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
  fetchPriority?: "high";
  /** The page's main picture: loaded at once and first (`next/image`'s priority for one file). */
  priority?: boolean;
  draggable?: boolean;
}) {
  const sources = pictureSources({ url, small, width: sourceWidth });
  if (!sources.srcSet) {
    return (
      <Image
        src={url}
        alt={alt}
        width={width}
        height={height}
        unoptimized
        priority={priority || undefined}
        loading={priority ? undefined : loading}
        fetchPriority={priority ? undefined : fetchPriority}
        draggable={draggable}
        className={className}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the owner's picture as its two files by width; next/image takes no srcset of its own
    <img
      src={sources.src}
      srcSet={sources.srcSet}
      sizes={sizes}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : (loading ?? "lazy")}
      fetchPriority={priority ? "high" : fetchPriority}
      decoding={priority ? undefined : "async"}
      draggable={draggable}
      className={className}
    />
  );
}

import Image from "next/image";

/**
 * A line's product picture beside its title, on the checkout and order
 * pages. Decorative: the title says what it is. Lines without one (a
 * sign-up fee) keep the space, so the titles line up.
 */
export function LineThumbnail({ src, size = 48 }: { src: string | null; size?: number }) {
  const box = { width: size, height: size };
  if (!src) return <span aria-hidden="true" className="shrink-0" style={box} />;
  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      unoptimized
      className="shrink-0 rounded-md bg-surface object-cover"
      style={box}
    />
  );
}

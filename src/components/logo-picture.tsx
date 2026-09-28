import type { CSSProperties } from "react";

import type { Logo } from "@/lib/navigation";

/**
 * A logo that suits what is behind it (D60): the logo for dark backgrounds
 * where the background is dark, if there is one. When that differs between
 * the theme's light and dark colours, both are drawn and globals.css shows
 * the one for the colours shown (the device's, or the visitor's choice,
 * D99), without any script; the hidden one is never fetched.
 */
export function LogoPicture({
  logo,
  logoDark,
  darkBehind,
  alt,
  className,
  style,
  priority = false,
}: {
  logo: Logo;
  logoDark: Logo | null;
  /** Whether the background is dark in the theme's light colours and in its dark ones (`darkBehindLogo`). */
  darkBehind: { light: boolean; dark: boolean };
  alt: string;
  className: string;
  style?: CSSProperties;
  priority?: boolean;
}) {
  const pick = (dark: boolean) => (dark && logoDark ? logoDark : logo);
  const light = pick(darkBehind.light);
  const dark = pick(darkBehind.dark);
  // The light colours' logo loads as a logo always has; the dark colours' one only once shown.
  const image = (shown: Logo, only?: "for-light-colors" | "for-dark-colors") => (
    // eslint-disable-next-line @next/next/no-img-element -- a store's own logo, at its own size.
    <img
      src={shown.url}
      alt={alt}
      width={shown.width}
      height={shown.height}
      loading={only === "for-dark-colors" ? "lazy" : undefined}
      fetchPriority={priority && only !== "for-dark-colors" ? "high" : undefined}
      className={only ? `${className} ${only}` : className}
      style={style}
    />
  );
  if (dark === light) return image(light);
  return (
    <>
      {image(light, "for-light-colors")}
      {image(dark, "for-dark-colors")}
    </>
  );
}

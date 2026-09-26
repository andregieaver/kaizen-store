import type { Logo } from "@/lib/navigation";

/**
 * A logo that suits what is behind it (D60): the logo for dark backgrounds
 * where the background is dark, if there is one. When that differs between
 * visitors in light and dark mode, the browser picks by the device's mode,
 * without any script.
 */
export function LogoPicture({
  logo,
  logoDark,
  darkBehind,
  alt,
  className,
  priority = false,
}: {
  logo: Logo;
  logoDark: Logo | null;
  /** Whether the background is dark for visitors in light mode and in dark mode (`darkBehindLogo`). */
  darkBehind: { light: boolean; dark: boolean };
  alt: string;
  className: string;
  priority?: boolean;
}) {
  const pick = (dark: boolean) => (dark && logoDark ? logoDark : logo);
  const light = pick(darkBehind.light);
  const dark = pick(darkBehind.dark);
  return (
    <picture className="contents">
      {dark !== light && (
        <source media="(prefers-color-scheme: dark)" srcSet={dark.url} width={dark.width} height={dark.height} />
      )}
      <img
        src={light.url}
        alt={alt}
        width={light.width}
        height={light.height}
        fetchPriority={priority ? "high" : undefined}
        className={className}
      />
    </picture>
  );
}

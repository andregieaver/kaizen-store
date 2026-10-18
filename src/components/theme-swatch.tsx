import type { ThemeSwatch } from "@/lib/theme-store";

/**
 * A look of a theme as a dot in its own colours (D275, `docs/themes-content-and-demo-stores.md` section 6): its background and its accent,
 * split across, with a hairline in its text colour. Drawn the same on the theme's page, its full-screen preview and its card; it says
 * nothing in words, so whatever draws it names the look beside it or in an `sr-only` text.
 */
export function SwatchDot({ swatch, size = "md" }: { swatch: ThemeSwatch | null | undefined; size?: "sm" | "md" }) {
  const s = swatch ?? { background: "#ffffff", accent: "#111111", text: "#111111" };
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full ${size === "sm" ? "size-4" : "size-7"}`}
      style={{
        background: `linear-gradient(135deg, ${s.background} 0 50%, ${s.accent} 50% 100%)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${s.text} 25%, transparent)`,
      }}
    />
  );
}

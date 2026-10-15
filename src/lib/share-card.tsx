import { ImageResponse } from "next/og";

/**
 * A plain share picture (1200 × 630, the size social sites and chat apps
 * show) for pages without a picture of their own: a name and a line.
 */
export function shareCard(title: string, line: string): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#ffffff",
          color: "#111111",
        }}
      >
        <div style={{ fontSize: title.length > 24 ? 72 : 96, fontWeight: 700, lineHeight: 1.1 }}>{title}</div>
        <div style={{ marginTop: 32, fontSize: 36, color: "#555555" }}>{line}</div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800" },
    },
  );
}

/**
 * A theme's share picture for the theme store (`docs/theme-phase-3.md`), for a theme without a picture of its own: its name and summary
 * drawn in its own light colours, with its accent as a band and the words "A free theme for Kaizena Flow".
 */
export function themeShareCard(
  theme: { title: string; summary: string },
  swatch: { background: string; surface: string; text: string; accent: string; accentText: string },
): ImageResponse {
  const hex = (value: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : fallback);
  const background = hex(swatch.background, "#ffffff");
  const text = hex(swatch.text, "#111111");
  const accent = hex(swatch.accent, "#111111");
  const accentText = hex(swatch.accentText, "#ffffff");
  const surface = hex(swatch.surface, "#f2f2f2");
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background, color: text }}>
        <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", padding: "72px 80px" }}>
          <div style={{ fontSize: theme.title.length > 20 ? 80 : 104, fontWeight: 700, lineHeight: 1.05 }}>{theme.title}</div>
          {theme.summary && <div style={{ marginTop: 28, fontSize: 38, maxWidth: 960, opacity: 0.8 }}>{theme.summary.slice(0, 140)}</div>}
          <div style={{ display: "flex", marginTop: 48, gap: 16 }}>
            {[background, surface, text, accent].map((colour, index) => (
              <div key={index} style={{ width: 64, height: 64, borderRadius: 32, background: colour, border: `3px solid ${text}` }} />
            ))}
          </div>
        </div>
        <div style={{ display: "flex", padding: "28px 80px", background: accent, color: accentText, fontSize: 32 }}>A free theme for Kaizena Flow</div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800" },
    },
  );
}

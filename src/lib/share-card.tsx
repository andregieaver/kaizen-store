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

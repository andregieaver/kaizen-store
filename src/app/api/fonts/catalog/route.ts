import { fontCatalog } from "@/server/fonts";

/** Google Fonts' families for the font picker (D59): `[family, category, weights, italics]`, most popular first. */
export async function GET() {
  return Response.json(fontCatalog(), {
    headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" },
  });
}

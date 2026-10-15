import { themeShareCard } from "@/lib/share-card";
import { themeStorePage } from "@/server/theme-store";

/**
 * A theme's share picture (`docs/theme-phase-3.md`), for a theme without a picture of its own: drawn from its published colours. On Kaizena
 * Flow's own host whether or not the theme store has a host of its own, as share pictures are given by full address.
 */
export async function GET(_request: Request, { params }: RouteContext<"/themes/[slug]/og.png">) {
  const theme = await themeStorePage((await params).slug);
  if (!theme) return new Response("Not found", { status: 404 });
  return themeShareCard(theme, theme.swatch);
}

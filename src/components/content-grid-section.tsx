import type { ContentGridBlock } from "@/lib/page-content";
import { gridData, type GridPlace } from "@/server/content-grid";

import { ContentGridView } from "./content-grid";

/** A content grid on the site (D51): its items looked up (and cached) on the server. */
export async function ContentGridSection({ block, place }: { block: ContentGridBlock; place: GridPlace }) {
  const data = await gridData(block, place);
  return <ContentGridView block={block} data={data} />;
}

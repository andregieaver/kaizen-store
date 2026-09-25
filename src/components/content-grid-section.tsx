import type { ContentGridBlock } from "@/lib/page-content";
import { gridData } from "@/server/content-grid";

import { ContentGridView } from "./content-grid";

/** A content grid on the site (D51): its items looked up (and cached) on the server. */
export async function ContentGridSection({ block, pageId }: { block: ContentGridBlock; pageId: string | null }) {
  const data = await gridData(block, pageId);
  return <ContentGridView block={block} data={data} />;
}

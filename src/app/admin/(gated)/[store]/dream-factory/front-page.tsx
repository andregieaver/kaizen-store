import type { EditablePage } from "@/server/pages";
import type { Store } from "@/server/stores";

import { PageDrawing } from "@/app/admin/(gated)/[store]/pages/drawing";

/**
 * The store's real front page in its live look (D422), drawn as the store's site draws it, with its theme and fonts, inside a browser
 * frame on the Dream Factory's page: what the owner agrees to at the end of stage 1 is exactly what visitors will see. It scrolls inside
 * the frame, so the page around it stays put.
 */
export function DreamFrontPage({ store, page, address, caption }: { store: Store; page: EditablePage; address: string; caption: string }) {
  return (
    <figure className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-lg border border-line shadow-sm">
        <div className="flex items-center gap-1.5 border-b border-line bg-sunken px-3 py-2" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-danger-text/50" />
          <span className="size-2.5 rounded-full bg-warning-text/50" />
          <span className="size-2.5 rounded-full bg-positive-text/50" />
          <span className="ml-2 truncate rounded bg-card px-2 py-0.5 text-xs text-ink-2">{address}</span>
        </div>
        <div className="max-h-[75vh] overflow-y-auto">
          <PageDrawing store={store} type="page" id={page.id} content={page.draft} publishedAt={page.publishedAt} themed />
        </div>
      </div>
      <figcaption className="text-sm text-ink-2">{caption}</figcaption>
    </figure>
  );
}

import type { GridData } from "@/lib/content-grid";
import type { Term, TermKind } from "@/lib/taxonomy";
import type { GridStore } from "@/server/content-grid";
import type { EditablePage } from "@/server/pages";
import type { SavedResult } from "@/server/saved-parts";
import type { TermsResult } from "@/server/taxonomy";

import type { Upload } from "./image-upload";

export type PageSaveState = { status: "saved"; page: EditablePage } | { status: "error"; problems: string[] };

/**
 * What the page editor and builder need from the pages' owner (D53):
 * Kaizen's own or a store's. The same editor serves both; only this
 * differs, filled in by each owner's routes with its server actions
 * (bound to the store, which each checks the editor belongs to).
 */
export type PageOwnerContext = {
  /** Null for Kaizen, else the store's id. */
  owner: string | null;
  /** Where the owner's pages are edited: `/admin/platform/pages` or `/admin/{store}/pages`. */
  adminBase: string;
  /** What comes before a page's address on the site: "" for Kaizen's, `/s/{store}/{market}` for a store's. */
  siteBase: string;
  /** The site's origin, for showing a page's full address. */
  origin: string;
  /** Addresses the owner's pages cannot take. */
  reserved: readonly string[];
  /** The owner's own description: the last fallback for a page without text. */
  defaultDescription: string;
  /** Uploads a picture; null where uploads are not set up. */
  upload: Upload | null;
  /** Stores whose products a content grid can show; empty on a store's pages, which show their own. */
  gridStores: GridStore[];
  actions: {
    save: (id: string | null, payload: string, publish: boolean) => Promise<PageSaveState>;
    unpublish: (id: string) => Promise<PageSaveState>;
    remove: (id: string) => Promise<{ problems: string[] } | void>;
    createTerm: (input: { kind: TermKind; name: string; slug?: string; parentId?: string | null }) => Promise<TermsResult>;
    createPart: (input: unknown) => Promise<SavedResult>;
    updatePart: (id: string, input: unknown) => Promise<SavedResult>;
    deletePart: (id: string) => Promise<SavedResult>;
    gridPreview: (block: unknown, pageId: string | null) => Promise<GridData | { problem: string }>;
    /** A store's product categories and tags, for a grid of its products. */
    gridTerms: (storeId: string) => Promise<Term[]>;
  };
};

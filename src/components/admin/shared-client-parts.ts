import { Icon } from "lucide-react";

import { AdminLink } from "@/components/admin/ui/link";

/**
 * The client parts nearly every admin page draws: the link wrapper (`AdminLink`, with `PolicyLink` and next/link inside it) and
 * Lucide's icon base. The root admin layout (`src/app/admin/layout.tsx`) imports this file, so Turbopack counts them among the
 * root layout's client references and puts them in the one chunk every admin route loads, instead of a copy in each layout's
 * and page's own first chunks. They were there by accident until bloat review step 2.21, through the root layout's server
 * imports (`getPlatformFavicon` > `pages.ts` > ... > a server component drawing them); 2.21 cut that path and 459 of 482 admin
 * routes grew by a median of 12.6 KB (ci-red issue 26). Nothing renders this list; it is held by
 * `src/components/admin/shared-client-parts.scan.test.ts`.
 */
export const SHARED_CLIENT_PARTS = [AdminLink, Icon] as const;

"use client";

import dynamic from "next/dynamic";

import { lazyView } from "@/components/lazy/lazy-view";

/**
 * A block's fields that load when its settings open (D916, `lazyView()`, D211), so the builder's first scripts do not carry them: the
 * App preview's, with its eleven kinds of part. Their own module, apart from `builder-fields.tsx`, as `block-fields.tsx` imports this
 * and the unit tests' eager stand-in for `builder-fields.tsx` imports `block-fields.tsx`. The `import()` stays inside `dynamic()`, as Next
 * finds the script to preload by it.
 */
export const AppPreviewFields = lazyView(dynamic(() => import("../app-preview-fields").then((m) => m.AppPreviewFields)));

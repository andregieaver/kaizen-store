import "server-only";

import type sharp from "sharp";

/**
 * The image library, loaded on first use: its native code is about 21 MB and most requests draw no picture (bloat review
 * step 0.5). The one place in src that imports sharp as a value; lazy-packages.scan.test.ts holds it. As browser.ts does
 * for Chromium.
 */
let loaded: Promise<typeof sharp> | undefined;
export const loadSharp = (): Promise<typeof sharp> => (loaded ??= import("sharp").then((m) => m.default));

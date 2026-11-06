"use client";

import type { ShellMessages } from "@/lib/admin-messages/shell.en";

import { useAdminText } from "./admin-text";

/**
 * A loading screen's words in the account's language (D312): a page's `loading.tsx` is drawn inside the signed-in layout, whose
 * provider holds the `shell` area, so the screen keeps its skeleton on the server and says what it waits for here.
 */
export function LoadingWords({ of }: { of: keyof ShellMessages["loading"] }) {
  return <>{useAdminText("shell").loading[of]}</>;
}

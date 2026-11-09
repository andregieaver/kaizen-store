"use client";

import { usePathname } from "next/navigation";

import { fillWords } from "@/lib/admin-fill";
import { canPlatform, platformAreaOfPath, type PlatformRole } from "@/lib/platform-access";

export type PlatformRoleWords = {
  names: Record<PlatformRole, string>;
  notice: string;
  readOnly: string;
  what: Record<"support" | "content" | "finance", string>;
};

/**
 * A quiet line on a platform page someone on the team may look at but not change (D510): what their role changes instead, so a press that
 * would be refused is not a surprise. Nothing on a page of their own area, and nothing for an owner.
 */
export function PlatformRoleNotice({ role, words }: { role: PlatformRole; words: PlatformRoleWords }) {
  const pathname = usePathname() ?? "";
  if (role === "owner" || canPlatform(role, platformAreaOfPath(pathname))) return null;
  const text = role === "read_only" ? words.readOnly : fillWords(words.notice, { role: words.names[role], what: words.what[role] });
  return (
    <p role="note" className="mb-6 rounded-panel bg-sunken px-4 py-3 text-sm text-ink-2">
      {text}
    </p>
  );
}

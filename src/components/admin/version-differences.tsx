"use client";

import { differenceLine } from "@/lib/version-difference-words";
import type { PageDifference } from "@/lib/version-compare";

import { useAdminText } from "./admin-text";

/** The differences between two versions of a page in words (D358), one line each, from `compareVersions()`. */
export function VersionDifferences({ differences }: { differences: PageDifference[] }) {
  const all = useAdminText("builder");
  if (differences.length === 0) return <p className="text-sm text-muted">{all.differences.none}</p>;
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm" data-version-differences>
      {differences.map((d, i) => (
        <li key={i} className="break-words">
          {differenceLine(d, all)}
        </li>
      ))}
    </ul>
  );
}

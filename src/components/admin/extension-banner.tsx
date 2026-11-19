"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { fillWords } from "@/lib/admin-fill";
import { extensionOfPath, type ExtensionId } from "@/lib/extensions";

import { useAdminText } from "./admin-text";

/**
 * The store frame's line about a paid extension on its own pages (D748 E5, section 4.3 of the spec): in its grace period, until when; read-only
 * after it, where the pages open to be read and exported and nothing is sent or changed. Subscribe for the owner, "Ask your account owner"
 * for a member. Nothing on any other page, and nothing while every extension works. The grace period's last day comes written by the layout
 * (`untilDay`): it is the account's, on `PLATFORM_TIME_ZONE` as on Account → Extensions, and the frame's scripts carry no date formatter (D812).
 */
export function ExtensionBanner({
  banners,
  owner,
}: {
  banners: readonly { extension: ExtensionId; state: "grace" | "read_only"; untilDay: string }[];
  owner: boolean;
}) {
  const path = usePathname();
  const w = useAdminText("common").extensions;
  const here = extensionOfPath(path.split("/").slice(3).join("/"));
  const banner = here ? banners.find((b) => b.extension === here) : undefined;
  if (!banner) return null;
  const name = w.names[banner.extension];
  const line =
    banner.state === "grace"
      ? fillWords(w.grace, { name, date: banner.untilDay })
      : fillWords(w.readOnly, { name });
  return (
    <div role="status" className="mb-4 rounded-panel bg-sunken p-4 text-sm">
      <p>
        {line}{" "}
        {owner ? (
          <Link href="/admin/account/extensions" className="font-medium underline underline-offset-2">
            {banner.state === "grace" ? w.keepIt : w.startAgain}
          </Link>
        ) : (
          <span className="text-muted">{w.askOwner}</span>
        )}
      </p>
    </div>
  );
}

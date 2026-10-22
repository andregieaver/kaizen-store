import type { Metadata } from "next";

import { PlatformRoot, platformRootMetadata } from "@/components/platform-root";

import "../globals.css";

export function generateMetadata(): Promise<Metadata> {
  return platformRootMetadata("nb");
}

/**
 * Kaizena Flow's own site in Norwegian, under `/no` (D312, docs/platform-admin-i18n.md 3.1): a root layout of its own, so the page is
 * `<html lang="nb">`; its pages are the English routes' views drawn with `lang="nb"`. Moving between the languages loads the page anew.
 */
export default function NorwegianLayout({ children }: { children: React.ReactNode }) {
  return <PlatformRoot lang="nb">{children}</PlatformRoot>;
}

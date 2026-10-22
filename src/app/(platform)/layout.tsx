import type { Metadata } from "next";

import { PlatformRoot, platformRootMetadata } from "@/components/platform-root";

import "../globals.css";

export function generateMetadata(): Promise<Metadata> {
  return platformRootMetadata("en");
}

/** Kaizena Flow's own site in English, at the addresses it always had (D42, D312). */
export default function PlatformLayout({ children }: LayoutProps<"/">) {
  return <PlatformRoot lang="en">{children}</PlatformRoot>;
}

import type { Metadata } from "next";

import { ThemePreviewRoot, themePreviewRootMetadata } from "@/components/theme-preview-root";

import "../globals.css";

export function generateMetadata(): Promise<Metadata> {
  return themePreviewRootMetadata();
}

export default function ThemePreviewLayout({ children }: { children: React.ReactNode }) {
  return <ThemePreviewRoot lang="en">{children}</ThemePreviewRoot>;
}

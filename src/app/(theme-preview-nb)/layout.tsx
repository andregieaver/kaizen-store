import type { Metadata } from "next";

import { ThemePreviewRoot, themePreviewRootMetadata } from "@/components/theme-preview-root";

import "../globals.css";

export function generateMetadata(): Promise<Metadata> {
  return themePreviewRootMetadata();
}

/** A theme's full-screen preview in Norwegian (D312 P3): `<html lang="nb">`, a root of its own as the English one is. */
export default function NorwegianThemePreviewLayout({ children }: { children: React.ReactNode }) {
  return <ThemePreviewRoot lang="nb">{children}</ThemePreviewRoot>;
}

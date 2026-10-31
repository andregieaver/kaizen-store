import type { Metadata } from "next";

import { ReportRoute, reportMetadata } from "@/components/platform-routes/report";

export function generateMetadata(): Promise<Metadata> {
  return reportMetadata("nb");
}

export default function ReportPage() {
  return <ReportRoute lang="nb" />;
}

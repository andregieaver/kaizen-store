import type { Metadata } from "next";

import { StatusRoute, statusMetadata } from "@/components/platform-routes/status";

export function generateMetadata(): Promise<Metadata> {
  return statusMetadata("en");
}

export default function StatusPage() {
  return <StatusRoute lang="en" />;
}

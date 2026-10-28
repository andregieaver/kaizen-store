import type { Metadata } from "next";

import { StatusLinkRoute, statusLinkMetadata } from "@/components/platform-routes/status";

export const metadata: Metadata = statusLinkMetadata("en", "confirm");

export default function StatusLinkPage({ params }: PageProps<"/status/confirm/[token]">) {
  return <StatusLinkRoute lang="en" kind="confirm" params={params} />;
}

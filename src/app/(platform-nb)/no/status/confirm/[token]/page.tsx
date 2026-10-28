import type { Metadata } from "next";

import { StatusLinkRoute, statusLinkMetadata } from "@/components/platform-routes/status";

export const metadata: Metadata = statusLinkMetadata("nb", "confirm");

export default function StatusLinkPage({ params }: PageProps<"/no/status/confirm/[token]">) {
  return <StatusLinkRoute lang="nb" kind="confirm" params={params} />;
}

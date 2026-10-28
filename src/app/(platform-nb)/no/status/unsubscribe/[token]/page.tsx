import type { Metadata } from "next";

import { StatusLinkRoute, statusLinkMetadata } from "@/components/platform-routes/status";

export const metadata: Metadata = statusLinkMetadata("nb", "unsubscribe");

export default function StatusLinkPage({ params }: PageProps<"/no/status/unsubscribe/[token]">) {
  return <StatusLinkRoute lang="nb" kind="unsubscribe" params={params} />;
}

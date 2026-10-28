import type { Metadata } from "next";

import { StatusLinkRoute, statusLinkMetadata } from "@/components/platform-routes/status";

export const metadata: Metadata = statusLinkMetadata("en", "unsubscribe");

export default function StatusLinkPage({ params }: PageProps<"/status/unsubscribe/[token]">) {
  return <StatusLinkRoute lang="en" kind="unsubscribe" params={params} />;
}

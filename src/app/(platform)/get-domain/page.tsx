import type { Metadata } from "next";
import { Suspense } from "react";

import { GetDomainRoute, getDomainMetadata } from "@/components/platform-routes/get-domain";

export function generateMetadata(): Promise<Metadata> {
  return getDomainMetadata("en");
}

/** The name chosen comes from the address, read per request inside the boundary. */
async function WithDomain({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).domain;
  const domain = typeof raw === "string" && /^[a-z0-9.-]{3,253}$/i.test(raw) ? raw.toLowerCase() : null;
  return <GetDomainRoute lang="en" domain={domain} />;
}

export default function GetDomainPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense>
      <WithDomain searchParams={props.searchParams} />
    </Suspense>
  );
}

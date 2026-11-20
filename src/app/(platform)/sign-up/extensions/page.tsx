import type { Metadata } from "next";

import { ExtensionsSignUpRoute, extensionsSignUpMetadata } from "@/components/platform-routes/sign-up-extensions";

export function generateMetadata(): Promise<Metadata> {
  return extensionsSignUpMetadata("en");
}

/** The sign-up for extensions in English (D748 E7); `?with=` ticks the extensions a product page sends here for. */
export default async function ExtensionsSignUpPage({ searchParams }: PageProps<"/sign-up/extensions">) {
  const ticked = String((await searchParams).with ?? "").split(",");
  return <ExtensionsSignUpRoute lang="en" ticked={ticked} />;
}

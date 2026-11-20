import type { Metadata } from "next";

import { ExtensionsSignUpRoute, extensionsSignUpMetadata } from "@/components/platform-routes/sign-up-extensions";

export function generateMetadata(): Promise<Metadata> {
  return extensionsSignUpMetadata("en");
}

/** The sign-up for extensions in English (D748 E7); `?with=` ticks the extensions a product page sends here for. */
export default function ExtensionsSignUpPage({ searchParams }: PageProps<"/sign-up/extensions">) {
  // Read inside the form's own <Suspense> (cacheComponents): the rest of the page is prerendered.
  const ticked = searchParams.then((params) => String(params.with ?? "").split(","));
  return <ExtensionsSignUpRoute lang="en" ticked={ticked} />;
}

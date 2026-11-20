import type { Metadata } from "next";

import { ExtensionsSignUpRoute, extensionsSignUpMetadata } from "@/components/platform-routes/sign-up-extensions";

export function generateMetadata(): Promise<Metadata> {
  return extensionsSignUpMetadata("nb");
}

/** Registrering for utvidelser på norsk (D748 E7); `?with=` krysser av for utvidelsene en produktside sender hit for. */
export default function NorwegianExtensionsSignUp({ searchParams }: PageProps<"/no/sign-up/extensions">) {
  // Read inside the form's own <Suspense> (cacheComponents): the rest of the page is prerendered.
  const ticked = searchParams.then((params) => String(params.with ?? "").split(","));
  return <ExtensionsSignUpRoute lang="nb" ticked={ticked} />;
}

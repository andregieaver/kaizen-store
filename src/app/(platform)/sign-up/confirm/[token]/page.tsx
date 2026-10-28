import type { Metadata } from "next";

import { SignUpConfirmRoute, signUpConfirmMetadata } from "@/components/platform-routes/sign-up-confirm";

export const metadata: Metadata = signUpConfirmMetadata("en");

export default function SignUpConfirmPage({ params }: PageProps<"/sign-up/confirm/[token]">) {
  return <SignUpConfirmRoute lang="en" params={params} />;
}

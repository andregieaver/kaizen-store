import type { Metadata } from "next";

import { SignUpConfirmRoute, signUpConfirmMetadata } from "@/components/platform-routes/sign-up-confirm";

export const metadata: Metadata = signUpConfirmMetadata("nb");

export default function NorwegianSignUpConfirm({ params }: PageProps<"/no/sign-up/confirm/[token]">) {
  return <SignUpConfirmRoute lang="nb" params={params} />;
}

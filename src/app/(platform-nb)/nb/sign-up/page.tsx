import type { Metadata } from "next";

import { SignUpRoute, signUpMetadata } from "@/components/platform-routes/sign-up";

export function generateMetadata(): Promise<Metadata> {
  return signUpMetadata("nb");
}

export default function NorwegianSignUp() {
  return <SignUpRoute lang="nb" />;
}

import type { Metadata } from "next";

import { SignUpRoute, signUpMetadata } from "@/components/platform-routes/sign-up";

export function generateMetadata(): Promise<Metadata> {
  return signUpMetadata("en");
}

export default function SignUpPage() {
  return <SignUpRoute lang="en" />;
}

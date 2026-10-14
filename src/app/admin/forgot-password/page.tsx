import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { FocusFrame } from "@/components/admin/ui";

import { requestPasswordReset } from "../sign-in/actions";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <FocusFrame
      back={{ href: "/admin/sign-in", label: "Back to sign in" }}
      title="Choose a new password"
      description="Enter your email and we will send you a link. It signs you in and opens your account, where you choose the new password. This also works if you have never had a password."
    >
      <ActionForm action={requestPasswordReset} replaceOnSuccess className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <input
            type="email"
            name="email"
            required
            autoComplete="username"
            className="min-h-10 rounded-md border border-line bg-card px-3 font-normal"
          />
        </label>
        <SubmitButton>Email me a link</SubmitButton>
      </ActionForm>
    </FocusFrame>
  );
}

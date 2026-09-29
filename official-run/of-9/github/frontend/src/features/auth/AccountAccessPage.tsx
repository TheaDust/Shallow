import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { SignInForm } from "./SignInForm";
import { SignUpForm } from "./SignUpForm";

export type AccountAccessMode = "signin" | "signup" | "forgot-password";

export function AccountAccessPage({ mode }: { mode: AccountAccessMode }) {
  if (mode === "signup") return <SignUpForm />;
  if (mode === "forgot-password") return <ForgotPasswordForm />;
  return <SignInForm />;
}

import { SignInForm } from "./forms/SignInForm";
import { SignUpForm } from "./forms/SignUpForm";
import { RecoveryForm } from "./forms/RecoveryForm";

export type AccessMode = "signin" | "signup" | "recover";

export function AccountAccessPage({ mode }: { mode: AccessMode }) {
  return (
    <main className="account-access">
      <div className="account-access__card">
        {mode === "signin" && (
          <>
            <h1>Sign in</h1>
            <SignInForm />
          </>
        )}
        {mode === "signup" && (
          <>
            <h1>Sign up</h1>
            <SignUpForm />
          </>
        )}
        {mode === "recover" && (
          <>
            <h1>Forgot password</h1>
            <RecoveryForm />
          </>
        )}
      </div>
    </main>
  );
}

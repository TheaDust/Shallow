import { RecoverForm } from "./RecoverForm";
import { RegisterForm } from "./RegisterForm";
import { SignInForm } from "./SignInForm";

export type AccountAccessView = "signin" | "register" | "recover";

/**
 * The shared account-access page used by visitors to sign in, register or
 * recover a password; each entry renders the matching form.
 */
export function AccountAccessPage({ view }: { view: AccountAccessView }) {
  return (
    <section className="account-access" aria-label="Account access">
      {view === "signin" ? <SignInForm /> : null}
      {view === "register" ? <RegisterForm /> : null}
      {view === "recover" ? <RecoverForm /> : null}
    </section>
  );
}

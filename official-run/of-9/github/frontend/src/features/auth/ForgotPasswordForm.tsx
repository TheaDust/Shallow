import { useState, type FormEvent } from "react";

import { Button, FormField } from "../../ui";
import { requestPasswordReset, resetPassword, type FieldErrors } from "./api";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "reset">("email");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(false);

  const requestReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    try {
      await requestPasswordReset(email);
      setStep("reset");
    } finally {
      setBusy(false);
    }
  };

  const reset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    try {
      const result = await resetPassword({ email, code, newPassword, confirmPassword });
      if (result.ok) {
        setUpdated(true);
      } else {
        setErrors(result.errors);
        setNewPassword("");
        setConfirmPassword("");
      }
    } finally {
      setBusy(false);
    }
  };

  if (updated) {
    return (
      <section className="account-access">
        <p role="status" className="account-access__notice">
          Password updated
        </p>
      </section>
    );
  }

  return (
    <section className="account-access">
      <h1>Reset your password</h1>
      {step === "email" ? (
        <form className="account-access__form" onSubmit={requestReset} noValidate>
          <FormField id="recovery-email" label="Email">
            <input
              id="recovery-email"
              type="text"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>
          <Button type="submit" variant="primary" disabled={busy}>
            Send reset link
          </Button>
        </form>
      ) : (
        <form className="account-access__form" onSubmit={reset} noValidate>
          <div className="recovery-code">
            <span>Local verification code</span>
            <strong>123456</strong>
          </div>
          <FormField id="recovery-email" label="Email" error={errors.email}>
            <input
              id="recovery-email"
              type="text"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>
          <FormField id="recovery-code" label="Verification code" error={errors.code}>
            <input
              id="recovery-code"
              type="text"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </FormField>
          <FormField id="recovery-new-password" label="New password" error={errors.newPassword}>
            <input
              id="recovery-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </FormField>
          <FormField id="recovery-confirm-password" label="Confirm password" error={errors.confirmPassword}>
            <input
              id="recovery-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </FormField>
          <Button type="submit" variant="primary" disabled={busy}>
            Reset password
          </Button>
        </form>
      )}
      <nav className="account-access__links" aria-label="Account access">
        <a href="#/signin">Sign in</a>
      </nav>
    </section>
  );
}

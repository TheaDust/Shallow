import { useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";
import {
  requestPasswordReset,
  resetPassword,
  type FieldErrors,
} from "../lib/auth-api";

export function ForgotPasswordPage() {
  const [step, setStep] = useState<"request" | "reset">("request");
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestPasswordReset(email);
      setVerificationCode(result.code);
      setStep("reset");
    } catch {
      setError("Unable to start the recovery. Please try again.");
    }
    setBusy(false);
  };

  const handleReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    setErrors({});
    try {
      const result = await resetPassword({ email, code, newPassword, confirmPassword });
      if (result.ok) {
        setMessage(result.message);
        setCode("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setErrors(result.fieldErrors);
      }
    } catch {
      setError("Unable to reset the password. Please try again.");
    }
    setBusy(false);
  };

  return (
    <main className="page">
      <section className="page__body auth">
        <h1 className="auth__title">Reset your password</h1>
        {error ? (
          <p className="auth__error" role="alert">
            {error}
          </p>
        ) : null}

        {step === "request" ? (
          <form className="auth__form" onSubmit={handleRequest} noValidate>
            <FormField id="recovery-request-email" label="Email">
              <input
                id="recovery-request-email"
                name="email"
                type="email"
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
          <>
            <p className="recovery__code-value">{verificationCode}</p>
            <p className="recovery__hint">Enter this code with a new password to finish the reset.</p>
            <form className="auth__form" onSubmit={handleReset} noValidate>
              {message ? (
                <p className="auth__status" role="status">
                  {message}
                </p>
              ) : null}
              <FormField id="recovery-email" label="Email">
                <input
                  id="recovery-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </FormField>
              <FormField id="recovery-code" label="Verification code" error={errors.code}>
                <input
                  id="recovery-code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </FormField>
              <FormField id="recovery-new-password" label="New password" error={errors.newPassword}>
                <input
                  id="recovery-new-password"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </FormField>
              <FormField
                id="recovery-confirm-password"
                label="Confirm password"
                error={errors.confirmPassword}
              >
                <input
                  id="recovery-confirm-password"
                  name="confirmPassword"
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
          </>
        )}

        <p className="auth__switch">
          <a href="#/sign-in">Sign in</a>
        </p>
      </section>
    </main>
  );
}

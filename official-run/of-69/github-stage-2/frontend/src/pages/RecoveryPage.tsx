import { useState, type FormEvent } from "react";

import { Button, FormField } from "../ui";
import { ApiError } from "../lib/api";
import { resetPassword, startRecovery } from "../lib/session-api";

type Step = "request" | "reset";

export function RecoveryPage() {
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [revealedCode, setRevealedCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const fixedCode = await startRecovery(email);
      setRevealedCode(fixedCode);
      setStep("reset");
    } catch {
      setError("Unable to start the recovery flow. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await resetPassword({ email, code, newPassword, confirmPassword });
      setMessage(result);
      setCode("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (caught) {
      setError(caught instanceof ApiError ? String(caught.message) : "Unable to reset the password.");
      setNewPassword("");
      setConfirmPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <main>
        <h1>Forgot password</h1>
        {message ? (
          <p className="form-success" role="status">
            {message}
          </p>
        ) : null}
        <form className="auth-form" noValidate onSubmit={step === "request" ? requestReset : submitReset}>
          <FormField id="recovery-email" label="Email">
            <input
              id="recovery-email"
              name="email"
              type="text"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>
          {step === "reset" ? (
            <>
              <p className="recovery-hint">Enter this verification code to choose a new password.</p>
              <p className="recovery-code">{revealedCode}</p>
              <FormField id="recovery-code" label="Verification code">
                <input
                  id="recovery-code"
                  name="code"
                  type="text"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </FormField>
              <FormField id="recovery-new-password" label="New password">
                <input
                  id="recovery-new-password"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </FormField>
              <FormField id="recovery-confirm-password" label="Confirm password">
                <input
                  id="recovery-confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </FormField>
            </>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" disabled={busy}>
            {step === "request" ? "Send reset link" : "Reset password"}
          </Button>
        </form>
        {step === "reset" && message ? (
          <p className="auth-links">
            <a href="#/signin">Sign in</a>
          </p>
        ) : null}
      </main>
    </div>
  );
}

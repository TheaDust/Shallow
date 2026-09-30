import { useState, type ChangeEvent, type FormEvent } from "react";

import {
  requestPasswordReset,
  submitPasswordReset,
  type RecoveryFieldErrors,
} from "../lib/accounts-api";
import { navigate, useHashLocation } from "../lib/hash-route";
import { Button, FormField } from "../ui";

/** Shown when the page is reopened directly on the second step of the flow. */
const LOCAL_VERIFICATION_CODE = "123456";

/**
 * Password-recovery view of the shared account-access page. Step one only asks
 * for an address (registered and unknown addresses behave identically); step two
 * shows the fixed local code plus the reset form.
 */
export function PasswordResetPage() {
  const location = useHashLocation();
  const verifying = location.search.get("step") === "verify";
  const [email, setEmail] = useState(location.search.get("email") ?? "");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayCode, setDisplayCode] = useState(LOCAL_VERIFICATION_CODE);
  const [fields, setFields] = useState<RecoveryFieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [updated, setUpdated] = useState(false);

  const passwordUpdated = updated || location.search.get("done") === "1";

  const updateEmail = (event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value);
  const updateCode = (event: ChangeEvent<HTMLInputElement>) => setCode(event.target.value);
  const updateNewPassword = (event: ChangeEvent<HTMLInputElement>) => setNewPassword(event.target.value);
  const updateConfirmPassword = (event: ChangeEvent<HTMLInputElement>) => setConfirmPassword(event.target.value);

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);
    setFields({});
    setUpdated(false);
    try {
      const nextCode = await requestPasswordReset(email);
      setDisplayCode(nextCode || LOCAL_VERIFICATION_CODE);
      navigate("/password-reset", new URLSearchParams({ step: "verify", email }));
    } catch {
      setMessage("Password recovery is unavailable right now.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);
    // Values are captured so that clearing a submitted password can never drop
    // input the visitor entered while the request was still in flight.
    const attempted = { code, newPassword, confirmPassword };
    const result = await submitPasswordReset({ email, ...attempted });
    setSubmitting(false);
    const clearIfUnchanged = (attemptedValue: string) => (current: string) =>
      current === attemptedValue ? "" : current;
    if (result.ok) {
      setFields({});
      setUpdated(true);
      setCode(clearIfUnchanged(attempted.code));
      setNewPassword(clearIfUnchanged(attempted.newPassword));
      setConfirmPassword(clearIfUnchanged(attempted.confirmPassword));
      navigate("/password-reset", new URLSearchParams({ step: "verify", email, done: "1" }));
      return;
    }
    setFields(result.fields);
    setMessage(Object.keys(result.fields).length > 0 ? null : result.message);
    // Passwords are never redisplayed; the address and the code stay available.
    setNewPassword(clearIfUnchanged(attempted.newPassword));
    setConfirmPassword(clearIfUnchanged(attempted.confirmPassword));
  }

  if (!verifying) {
    return (
      <main>
        <h1>Reset your password</h1>
        {message ? (
          <p role="alert" className="form-message form-message--error">
            {message}
          </p>
        ) : null}
        <form className="auth-form" noValidate onSubmit={handleRequest}>
          <FormField id="recovery-email" label="Email">
            <input
              id="recovery-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={updateEmail}
            />
          </FormField>
          <Button type="submit" variant="primary" disabled={submitting}>
            Send reset link
          </Button>
        </form>
      </main>
    );
  }

  return (
    <main>
      <h1>Reset your password</h1>
      {passwordUpdated ? (
        <p role="status" className="form-message form-message--success">
          Password updated
        </p>
      ) : null}
      {message ? (
        <p role="alert" className="form-message form-message--error">
          {message}
        </p>
      ) : null}
      <div className="reset-code">
        <p className="reset-code__hint">Local demonstration verification code</p>
        <p className="reset-code__value">{displayCode}</p>
      </div>
      <form className="auth-form" noValidate onSubmit={handleReset}>
        <FormField id="recovery-code" label="Verification code" error={fields.verificationCode}>
          <input
            id="recovery-code"
            name="verificationCode"
            type="text"
            autoComplete="one-time-code"
            value={code}
            onChange={updateCode}
          />
        </FormField>
        <FormField id="recovery-new-password" label="New password" error={fields.newPassword}>
          <input
            id="recovery-new-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={updateNewPassword}
          />
        </FormField>
        <FormField id="recovery-confirm-password" label="Confirm password" error={fields.confirmPassword}>
          <input
            id="recovery-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={updateConfirmPassword}
          />
        </FormField>
        <Button type="submit" variant="primary" disabled={submitting}>
          Reset password
        </Button>
      </form>
    </main>
  );
}

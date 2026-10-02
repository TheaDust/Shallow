import { useState, type FormEvent } from "react";

import { fieldErrorsOf, messageOf, resetPasswordRequest, type FieldErrors } from "../../lib/session-api";
import { Button, FormField, fieldDescriptionIds } from "../../ui";

// The local product never sends email; recovery always shows this fixed code.
const VERIFICATION_CODE = "123456";

export function RecoverForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [step, setStep] = useState<"request" | "reset" | "done">("request");
  const [statusMessage, setStatusMessage] = useState("Password updated");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFieldErrors({});
    setFailure(null);
    if (!email.trim()) {
      setFieldErrors({ email: "Email format is invalid" });
      return;
    }
    // Both registered and unknown addresses continue in the same step so the
    // page never reveals whether an account exists, and no email is required.
    setStep("reset");
  }

  async function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const message = await resetPasswordRequest({ email, code, newPassword, confirmPassword });
      setFieldErrors({});
      // Password fields never redisplay what was submitted.
      setNewPassword("");
      setConfirmPassword("");
      setStatusMessage(message || "Password updated");
      setStep("done");
    } catch (error) {
      const errors = fieldErrorsOf(error);
      setFieldErrors(errors);
      setNewPassword("");
      setConfirmPassword("");
      if (Object.keys(errors).length === 0) {
        setFailure(messageOf(error, "Unable to reset the password right now. Please try again."));
      }
    } finally {
      setBusy(false);
    }
  }

  if (step === "done") {
    return (
      <div className="account-access__view">
        <h1>Reset your password</h1>
        <p className="form-status" role="status">
          {statusMessage || "Password updated"}
        </p>
        <p className="account-access__aside">
          <a href="#/login">Sign in</a>
        </p>
      </div>
    );
  }

  return (
    <div className="account-access__view">
      <h1>Reset your password</h1>
      {failure ? (
        <p className="form-error" role="alert">
          {failure}
        </p>
      ) : null}
      {step === "request" ? (
        <form className="account-form" noValidate onSubmit={handleRequest}>
          <FormField id="recover-email" label="Email" error={fieldErrors.email}>
            <input
              id="recover-email"
              name="email"
              type="email"
              autoComplete="email"
              aria-describedby={fieldDescriptionIds("recover-email", {
                error: Boolean(fieldErrors.email),
              })}
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
          <p className="verification-code">
            Local verification code: <span className="verification-code__value">{VERIFICATION_CODE}</span>
          </p>
          <form className="account-form" noValidate onSubmit={handleReset}>
            <FormField id="recover-reset-email" label="Email" error={fieldErrors.email}>
              <input
                id="recover-reset-email"
                name="email"
                type="email"
                autoComplete="email"
                aria-describedby={fieldDescriptionIds("recover-reset-email", {
                  error: Boolean(fieldErrors.email),
                })}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </FormField>
            <FormField id="recover-code" label="Verification code" error={fieldErrors.code}>
              <input
                id="recover-code"
                name="code"
                type="text"
                inputMode="numeric"
                aria-describedby={fieldDescriptionIds("recover-code", {
                  error: Boolean(fieldErrors.code),
                })}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </FormField>
            <FormField id="recover-new-password" label="New password" error={fieldErrors.newPassword}>
              <input
                id="recover-new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                aria-describedby={fieldDescriptionIds("recover-new-password", {
                  error: Boolean(fieldErrors.newPassword),
                })}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </FormField>
            <FormField
              id="recover-confirm-password"
              label="Confirm password"
              error={fieldErrors.confirmPassword}
            >
              <input
                id="recover-confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                aria-describedby={fieldDescriptionIds("recover-confirm-password", {
                  error: Boolean(fieldErrors.confirmPassword),
                })}
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
    </div>
  );
}

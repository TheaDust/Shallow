import { useEffect, useState, type FormEvent } from "react";

import { confirmPasswordReset, errorMessageOf, fieldErrorsOf, requestPasswordReset } from "../auth/api";
import type { FieldErrors } from "../auth/types";
import { navigate, useHashLocation } from "../lib/hash-route";
import { Button, FormField, fieldDescriptionIds } from "../ui";

const FALLBACK_ERROR = "We could not reset your password. Try again.";

/**
 * Password recovery of the account-access page. Submitting an email leads to the
 * reset step, which shows the fixed verification code for registered and unknown
 * addresses alike; only a correct code with compliant passwords updates the
 * account.
 */
export function PasswordResetPage() {
  const location = useHashLocation();
  const emailParam = location.search.get("email") ?? "";

  const [email, setEmail] = useState(emailParam);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState<string | null>(null);
  const [codeLoadError, setCodeLoadError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    setEmail(emailParam);
    if (!emailParam) return;
    let cancelled = false;
    setVerificationCode(null);
    setCodeLoadError(null);
    requestPasswordReset(emailParam)
      .then((value) => {
        if (!cancelled) setVerificationCode(value);
      })
      .catch(() => {
        if (!cancelled) setCodeLoadError("We could not start the recovery flow. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [emailParam]);

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setRequestError(null);
    try {
      await requestPasswordReset(email);
      navigate("/forgot-password", new URLSearchParams({ email }));
    } catch (failure) {
      const fieldErrors = fieldErrorsOf(failure);
      if (fieldErrors) setErrors(fieldErrors);
      else setRequestError(errorMessageOf(failure) ?? FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      await confirmPasswordReset({ email, code, newPassword, confirmPassword });
      setUpdated(true);
    } catch (failure) {
      const fieldErrors = fieldErrorsOf(failure);
      if (fieldErrors) setErrors(fieldErrors);
      else setFormError(errorMessageOf(failure) ?? FALLBACK_ERROR);
      setNewPassword("");
      setConfirmPassword("");
    } finally {
      setBusy(false);
    }
  }

  if (updated) {
    return (
      <section className="page page--narrow">
        <h1>Reset your password</h1>
        <p className="app-form__status" role="status">
          Password updated
        </p>
        <p className="page__links">
          <a href="#/login">Sign in</a>
        </p>
      </section>
    );
  }

  if (!emailParam) {
    return (
      <section className="page page--narrow">
        <h1>Reset your password</h1>
        <form className="app-form" aria-label="Forgot password" noValidate onSubmit={handleRequest}>
          <FormField id="recovery-email" label="Email" error={errors.email}>
            <input
              id="recovery-email"
              name="email"
              type="email"
              autoComplete="email"
              aria-describedby={fieldDescriptionIds("recovery-email", { error: Boolean(errors.email) })}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>
          {requestError ? (
            <p className="app-form__error" role="alert">
              {requestError}
            </p>
          ) : null}
          <div className="app-form__actions">
            <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
              Send reset link
            </Button>
          </div>
        </form>
        <p className="page__links">
          <a href="#/login">Sign in</a>
        </p>
      </section>
    );
  }

  return (
    <section className="page page--narrow">
      <h1>Reset your password</h1>
      {verificationCode ? (
        <p className="app-form__hint">
          Enter the verification code <strong>{verificationCode}</strong> together with your new
          password.
        </p>
      ) : (
        <p className="app-form__hint" role="status">
          Preparing the verification code…
        </p>
      )}
      {codeLoadError ? (
        <p className="app-form__error" role="alert">
          {codeLoadError}
        </p>
      ) : null}
      <form className="app-form" aria-label="Reset password" noValidate onSubmit={handleReset}>
        <FormField id="reset-email" label="Email" error={errors.email}>
          <input
            id="reset-email"
            name="email"
            type="email"
            autoComplete="email"
            aria-describedby={fieldDescriptionIds("reset-email", { error: Boolean(errors.email) })}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>
        <FormField id="reset-code" label="Verification code" error={errors.code}>
          <input
            id="reset-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-describedby={fieldDescriptionIds("reset-code", { error: Boolean(errors.code) })}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </FormField>
        <FormField id="reset-new-password" label="New password" error={errors.newPassword}>
          <input
            id="reset-new-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            aria-describedby={fieldDescriptionIds("reset-new-password", { error: Boolean(errors.newPassword) })}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </FormField>
        <FormField id="reset-confirm-password" label="Confirm password" error={errors.confirmPassword}>
          <input
            id="reset-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-describedby={fieldDescriptionIds("reset-confirm-password", { error: Boolean(errors.confirmPassword) })}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </FormField>
        {formError ? (
          <p className="app-form__error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="app-form__actions">
          <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
            Reset password
          </Button>
        </div>
      </form>
      <p className="page__links">
        <a href="#/login">Sign in</a>
      </p>
    </section>
  );
}

import { useState, type FormEvent } from "react";

import { changePassword, errorMessageOf, fieldErrorsOf } from "../auth/api";
import type { FieldErrors } from "../auth/types";
import { Button, FormField, fieldDescriptionIds } from "../ui";

const FALLBACK_ERROR = "We could not update your password. Try again.";

/**
 * Security page of account Settings. The server owns every rule and message:
 * the current password is verified against the session's account, the candidate
 * password must satisfy the password rules and match its confirmation exactly,
 * and the page only reports what the server answered.
 */
export function PasswordSettingsPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setFormError(null);
    setMessage(null);
    try {
      setMessage(await changePassword({ currentPassword, newPassword, confirmPassword }));
    } catch (failure) {
      const fieldErrors = fieldErrorsOf(failure);
      if (fieldErrors) {
        setErrors(fieldErrors);
      } else {
        setFormError(errorMessageOf(failure) ?? FALLBACK_ERROR);
      }
    } finally {
      // Passwords are never echoed back into the page, on success or failure.
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setBusy(false);
    }
  }

  return (
    <section className="page page--narrow">
      <h1>Password and authentication</h1>
      <form className="app-form" aria-label="Password and authentication" noValidate onSubmit={handleSubmit}>
        <FormField id="password-current" label="Current password" error={errors.currentPassword}>
          <input
            id="password-current"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            aria-describedby={fieldDescriptionIds("password-current", { error: Boolean(errors.currentPassword) })}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </FormField>
        <FormField id="password-new" label="New password" error={errors.newPassword}>
          <input
            id="password-new"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            aria-describedby={fieldDescriptionIds("password-new", { error: Boolean(errors.newPassword) })}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </FormField>
        <FormField id="password-confirm" label="Confirm password" error={errors.confirmPassword}>
          <input
            id="password-confirm"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-describedby={fieldDescriptionIds("password-confirm", { error: Boolean(errors.confirmPassword) })}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </FormField>
        {formError ? (
          <p className="app-form__error" role="alert">
            {formError}
          </p>
        ) : null}
        {message ? (
          <p className="app-form__success" role="status">
            {message}
          </p>
        ) : null}
        <div className="app-form__actions">
          <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
            Update password
          </Button>
        </div>
      </form>
    </section>
  );
}

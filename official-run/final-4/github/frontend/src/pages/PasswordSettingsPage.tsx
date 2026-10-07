import { useState, type FormEvent } from "react";

import { changePassword, type FieldErrors } from "../lib/auth-api";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";

/**
 * Security page used to change the signed-in account's password. Every rule is
 * re-checked on the server; this form only mirrors the returned field errors and
 * never renders a submitted password value back to the page.
 */
export function PasswordSettingsPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clearPasswords = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    setErrors({});
    try {
      const result = await changePassword({ currentPassword, newPassword, confirmPassword });
      if (result.ok) {
        setMessage(result.message);
      } else {
        setErrors(result.fieldErrors);
      }
      clearPasswords();
    } catch {
      setError("Unable to update the password. Please try again.");
      clearPasswords();
    }
    setBusy(false);
  };

  return (
    <main className="page">
      <section className="page__body settings">
        <h1 className="settings__title">Password and authentication</h1>
        <form className="auth__form settings__form" onSubmit={handleSubmit} noValidate>
          {message ? (
            <p className="auth__status" role="status">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="auth__error" role="alert">
              {error}
            </p>
          ) : null}
          <FormField
            id="settings-current-password"
            label="Current password"
            error={errors.currentPassword}
          >
            <input
              id="settings-current-password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </FormField>
          <FormField id="settings-new-password" label="New password" error={errors.newPassword}>
            <input
              id="settings-new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </FormField>
          <FormField
            id="settings-confirm-password"
            label="Confirm password"
            error={errors.confirmPassword}
          >
            <input
              id="settings-confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </FormField>
          <Button type="submit" variant="primary" disabled={busy}>
            Update password
          </Button>
        </form>
      </section>
    </main>
  );
}

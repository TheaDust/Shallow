import { useState, type FormEvent } from "react";

import { changePassword, fieldErrorsOf, messageOf, type Account, type FieldErrors } from "../api/auth";
import { AppHeader } from "../components/AppHeader";
import { makeHash } from "../lib/hash-route";
import { Button, FormField } from "../ui";

/**
 * The “Password and authentication” security page in account settings. It
 * changes only the signed-in account's password; the backend resolves the
 * account from the session cookie and never trusts a client-supplied identity.
 */
export function PasswordSettingsPage({ account }: { account: Account }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    setStatus(null);
    try {
      const result = await changePassword({ currentPassword, newPassword, confirmPassword });
      setStatus(result.message);
    } catch (error) {
      const fields = fieldErrorsOf(error);
      if (Object.keys(fields).length > 0) setErrors(fields);
      else setFormError(messageOf(error, "Password change failed"));
    } finally {
      // Passwords must never be echoed back into the page.
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPending(false);
    }
  };

  return (
    <main>
      <AppHeader account={account} />
      <h1>Password and authentication</h1>
      <form
        className="account-form"
        aria-label="Change password"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <FormField id="current-password" label="Current password" error={errors.currentPassword}>
          <input
            id="current-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </FormField>
        <FormField id="new-password" label="New password" error={errors.newPassword}>
          <input
            id="new-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </FormField>
        <FormField id="confirm-password" label="Confirm password" error={errors.confirmPassword}>
          <input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </FormField>
        {formError ? (
          <p className="form-error" role="alert">
            {formError}
          </p>
        ) : null}
        {status ? (
          <p className="form-status" role="status">
            {status}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={pending}>
          Update password
        </Button>
      </form>
      <p>
        <a href={makeHash("/settings")}>Back to settings</a>
      </p>
    </main>
  );
}

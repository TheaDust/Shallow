import { useState, type FormEvent } from "react";

import { AppHeader } from "../components/AppHeader";
import { ApiError } from "../lib/api";
import { changePassword, type Account, type ChangePasswordInput } from "../lib/session-api";
import { useSession } from "../session/session-context";
import { Button, FormField } from "../ui";

type FieldName = "currentPassword" | "newPassword" | "confirmPassword";
type FieldErrors = Partial<Record<FieldName, string>>;

const EMPTY_VALUES: ChangePasswordInput = { currentPassword: "", newPassword: "", confirmPassword: "" };

function extractErrors(caught: unknown): FieldErrors {
  if (caught instanceof ApiError && caught.body && typeof caught.body === "object" && "errors" in caught.body) {
    return (caught.body as { errors: FieldErrors }).errors;
  }
  return {};
}

/**
 * “Password and authentication” security form. It changes only the password
 * record of the signed-in account; the visible confirmation message comes from
 * the server response, and rejected changes keep the old credentials usable.
 */
export function PasswordSettingsPage({ account }: { account: Account }) {
  const { refresh } = useSession();
  const [values, setValues] = useState<ChangePasswordInput>(EMPTY_VALUES);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update(name: FieldName, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    setMessage(null);
    try {
      const result = await changePassword(values);
      setMessage(result);
      // Submitted passwords never reappear on the page.
      setValues(EMPTY_VALUES);
      // The session value is re-read so later requests use the same account.
      await refresh();
    } catch (caught) {
      const fieldErrors = extractErrors(caught);
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length === 0) {
        setFormError(caught instanceof ApiError ? String(caught.message) : "Unable to update the password.");
      }
      // No submitted password value is redisplayed after a rejected change.
      setValues(EMPTY_VALUES);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <AppHeader username={account.username} />
      <main>
        <h1>Password and authentication</h1>
        {message ? (
          <p className="form-success" role="status">
            {message}
          </p>
        ) : null}
        {formError ? (
          <p className="form-error" role="alert">
            {formError}
          </p>
        ) : null}
        <form className="auth-form" noValidate onSubmit={handleSubmit}>
          <FormField id="password-current" label="Current password" error={errors.currentPassword}>
            <input
              id="password-current"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              value={values.currentPassword}
              onChange={(event) => update("currentPassword", event.target.value)}
            />
          </FormField>
          <FormField id="password-new" label="New password" error={errors.newPassword}>
            <input
              id="password-new"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              value={values.newPassword}
              onChange={(event) => update("newPassword", event.target.value)}
            />
          </FormField>
          <FormField id="password-confirm" label="Confirm password" error={errors.confirmPassword}>
            <input
              id="password-confirm"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={values.confirmPassword}
              onChange={(event) => update("confirmPassword", event.target.value)}
            />
          </FormField>
          <Button type="submit" variant="primary" disabled={busy}>
            Update password
          </Button>
        </form>
      </main>
    </div>
  );
}

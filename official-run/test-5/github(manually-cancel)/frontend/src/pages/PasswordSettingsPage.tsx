import { useState, type ChangeEvent, type FormEvent } from "react";

import type { PasswordChangeErrors } from "../auth/validation";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";
import { updatePassword } from "../session/session-api";
import { useSession } from "../session/SessionProvider";
import { AuthenticationRequired, BusyMain } from "./common";

interface ChangeValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const EMPTY_VALUES: ChangeValues = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

/**
 * REQ-1-3: the “Password and authentication” page of account settings. The
 * change applies to the signed-in account only and takes effect for the next
 * password-based sign-in.
 */
export function PasswordSettingsPage() {
  const { status, account } = useSession();
  const [values, setValues] = useState<ChangeValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<PasswordChangeErrors>({});
  const [updated, setUpdated] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field: keyof ChangeValues) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setValues((current) => ({ ...current, [field]: value }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    setUpdated(false);
    try {
      const result = await updatePassword(values);
      if (result.ok) {
        setErrors({});
        setValues(EMPTY_VALUES);
        setUpdated(true);
        return;
      }
      setErrors(result.errors);
    } catch {
      setFormError("Unable to update the password. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "loading") return <BusyMain />;
  if (!account) return <AuthenticationRequired />;

  return (
    <main>
      <h1>Password and authentication</h1>
      <p>Change the password used to sign in to your account.</p>
      {updated ? <p role="status">Password updated</p> : null}
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <FormField id="settings-current-password" label="Current password" error={errors.currentPassword}>
          <input
            id="settings-current-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            value={values.currentPassword}
            onChange={update("currentPassword")}
          />
        </FormField>
        <FormField id="settings-new-password" label="New password" error={errors.newPassword}>
          <input
            id="settings-new-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            value={values.newPassword}
            onChange={update("newPassword")}
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
            value={values.confirmPassword}
            onChange={update("confirmPassword")}
          />
        </FormField>
        {formError ? (
          <p className="auth-form__error" role="alert">
            {formError}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={submitting}>
          Update password
        </Button>
      </form>
    </main>
  );
}

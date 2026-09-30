import { useState, type ChangeEvent, type FormEvent } from "react";

import { SignInRequired } from "../auth/SignInRequired";
import { useAuth } from "../auth/AuthProvider";
import { changePassword, type PasswordChangeFieldErrors } from "../lib/accounts-api";
import { navigate, useHashLocation } from "../lib/hash-route";
import { Button, FormField } from "../ui";

interface PasswordValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const EMPTY_VALUES: PasswordValues = { currentPassword: "", newPassword: "", confirmPassword: "" };

/** Security page in account Settings used to change the current credentials. */
export function PasswordSettingsPage() {
  const { status, account } = useAuth();
  const location = useHashLocation();
  const [values, setValues] = useState<PasswordValues>(EMPTY_VALUES);
  const [fields, setFields] = useState<PasswordChangeFieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // The status survives a reload of the page through the query of the route.
  const passwordUpdated = updated || location.search.get("updated") === "1";

  const update = (key: keyof PasswordValues) => (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    setValues((current) => ({ ...current, [key]: value }));
  };

  /** Submitted passwords are never redisplayed, newer input is preserved. */
  const clearSubmitted = (attempted: PasswordValues) => {
    setValues((current) => ({
      currentPassword: current.currentPassword === attempted.currentPassword ? "" : current.currentPassword,
      newPassword: current.newPassword === attempted.newPassword ? "" : current.newPassword,
      confirmPassword: current.confirmPassword === attempted.confirmPassword ? "" : current.confirmPassword,
    }));
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);
    setUpdated(false);
    navigate("/settings/password");
    // The attempted values are captured so that clearing the submitted fields
    // never discards a password typed while the request was in flight.
    const attempted = values;
    const result = await changePassword(attempted);
    setSubmitting(false);
    clearSubmitted(attempted);
    if (result.ok) {
      setFields({});
      setUpdated(true);
      navigate("/settings/password", new URLSearchParams({ updated: "1" }));
      return;
    }
    setFields(result.fields);
    setMessage(Object.keys(result.fields).length > 0 ? null : result.message);
  }

  const loading = status === "loading";

  return (
    <main aria-busy={loading ? true : undefined}>
      <h1>Password and authentication</h1>
      {loading ? (
        <p role="status">Loading your session…</p>
      ) : account ? (
        <>
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
          <form className="auth-form" noValidate onSubmit={handleSubmit}>
            <FormField id="settings-current-password" label="Current password" error={fields.currentPassword}>
              <input
                id="settings-current-password"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                value={values.currentPassword}
                onChange={update("currentPassword")}
              />
            </FormField>
            <FormField id="settings-new-password" label="New password" error={fields.newPassword}>
              <input
                id="settings-new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                value={values.newPassword}
                onChange={update("newPassword")}
              />
            </FormField>
            <FormField id="settings-confirm-password" label="Confirm password" error={fields.confirmPassword}>
              <input
                id="settings-confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={values.confirmPassword}
                onChange={update("confirmPassword")}
              />
            </FormField>
            <Button type="submit" variant="primary" disabled={submitting}>
              Update password
            </Button>
          </form>
        </>
      ) : (
        <SignInRequired />
      )}
    </main>
  );
}

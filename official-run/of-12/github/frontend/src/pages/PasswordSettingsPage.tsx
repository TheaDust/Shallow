import { useRef, useState, type FormEvent } from "react";

import { Button, FormField } from "../ui";
import {
  changeAccountPassword,
  type PasswordChangeFieldErrors,
  type PasswordChangeInput,
} from "../features/auth/auth-api";
import { navigate, useHashLocation } from "../lib/hash-route";
import { clearFormFields, readFormValues } from "../lib/forms";
import { useSession } from "../lib/session";

const EMPTY_FORM: PasswordChangeInput = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

/**
 * "Password and authentication" (REQ-1-3): the security page in account
 * Settings that changes the current account's password. The page keeps the
 * same heading and form while the session loads, and a successful update is
 * reflected in the URL so a reload still reports it.
 */
export function PasswordSettingsPage() {
  const location = useHashLocation();
  const updated = location.search.get("updated") === "1";
  const { user, loading, refresh } = useSession();
  const [form, setForm] = useState<PasswordChangeInput>(EMPTY_FORM);
  const [errors, setErrors] = useState<PasswordChangeFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const update = <Key extends keyof PasswordChangeInput>(key: Key, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    const values = readFormValues(form, ["currentPassword", "newPassword", "confirmPassword"]);
    // Submitted passwords are never redisplayed.
    setForm(EMPTY_FORM);
    clearFormFields(form, ["currentPassword", "newPassword", "confirmPassword"]);
    inFlight.current = true;
    setBusy(true);
    setFormError(null);
    try {
      const result = await changeAccountPassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        confirmPassword: values.confirmPassword,
      });
      if (!result.ok) {
        setErrors(result.errors);
        setFormError(result.message ?? null);
        return;
      }
      setErrors({});
      await refresh();
      navigate("/settings/password", new URLSearchParams({ updated: "1" }));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <main className="settings-page">
      <h1>Password and authentication</h1>
      {updated && !loading && user ? (
        <p className="auth-page__notice" role="status">
          Password updated
        </p>
      ) : null}
      {loading ? (
        <p role="status">Loading your settings…</p>
      ) : user ? (
        <form className="settings-form" onSubmit={onSubmit} noValidate>
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
              value={form.currentPassword}
              onChange={(event) => update("currentPassword", event.target.value)}
            />
          </FormField>
          <FormField id="settings-new-password" label="New password" error={errors.newPassword}>
            <input
              id="settings-new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              value={form.newPassword}
              onChange={(event) => update("newPassword", event.target.value)}
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
              value={form.confirmPassword}
              onChange={(event) => update("confirmPassword", event.target.value)}
            />
          </FormField>
          {formError ? <p className="auth-form__error" role="alert">{formError}</p> : null}
          <Button type="submit" variant="primary" disabled={busy}>
            Update password
          </Button>
        </form>
      ) : (
        <>
          <p>You need to sign in to change your password.</p>
          <p>
            <a href="#/sign-in">Sign in</a>
          </p>
        </>
      )}
    </main>
  );
}

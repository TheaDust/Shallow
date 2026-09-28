import { useState } from "react";

import { AppHeader } from "../components/AppHeader";
import { changePassword, FieldErrors } from "../lib/account-api";
import { useSession } from "../session";

/**
 * Account Settings. “Password and authentication” is the security page used
 * to change the current account's credentials. The change affects only the
 * current account's password record and requires the correct current password,
 * a compliant new password, and a matching confirmation.
 */
export function SettingsPage() {
  const { status } = useSession();

  if (status === "loading") {
    return (
      <AppHeader>
        <main>
          <p>Loading…</p>
        </main>
      </AppHeader>
    );
  }

  if (status !== "authenticated") {
    return (
      <AppHeader>
        <main>
          <h1>Settings</h1>
          <p>Sign in to access settings.</p>
          <a href="#/signin">Sign in</a>
        </main>
      </AppHeader>
    );
  }

  return <PasswordSecurity />;
}

function PasswordSecurity() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [updated, setUpdated] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setErrors({});
    setUpdated(false);
    setSubmitting(true);
    try {
      const result = await changePassword({ currentPassword, newPassword, confirmPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setUpdated(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppHeader>
      <main>
        <h1>Settings</h1>
        <section className="settings-section" aria-labelledby="password-auth-title">
        <h2 id="password-auth-title">Password and authentication</h2>
        {updated && (
          <p className="account-form__status" role="status">
            Password updated
          </p>
        )}
        <form className="account-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="account-form__field">
            <label htmlFor="settings-current-password">Current password</label>
            <input
              id="settings-current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              aria-describedby={errors.currentPassword ? "settings-current-password-error" : undefined}
              autoComplete="current-password"
            />
            {errors.currentPassword && (
              <p className="account-form__error" id="settings-current-password-error">
                {errors.currentPassword}
              </p>
            )}
          </div>
          <div className="account-form__field">
            <label htmlFor="settings-new-password">New password</label>
            <input
              id="settings-new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              aria-describedby={errors.password ? "settings-new-password-error" : undefined}
              autoComplete="new-password"
            />
            {errors.password && (
              <p className="account-form__error" id="settings-new-password-error">
                {errors.password}
              </p>
            )}
          </div>
          <div className="account-form__field">
            <label htmlFor="settings-confirm-password">Confirm password</label>
            <input
              id="settings-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              aria-describedby={errors.confirmPassword ? "settings-confirm-password-error" : undefined}
              autoComplete="new-password"
            />
            {errors.confirmPassword && (
              <p className="account-form__error" id="settings-confirm-password-error">
                {errors.confirmPassword}
              </p>
            )}
          </div>
          <button type="submit" className="button button--primary" disabled={submitting}>
            Update password
          </button>
        </form>
      </section>
      </main>
    </AppHeader>
  );
}

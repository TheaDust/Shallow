import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiChangePassword } from '../api';
import { useSession } from '../session';
import { useRedirectTo } from '../router';
import type { ChangePasswordErrors } from '../types';

/**
 * "Password and authentication" security page inside account Settings
 * (REQ-1-3). The signed-in user provides the current password, a compliant
 * new password, and an identical confirmation; the server validates all three
 * fields and applies the change to the current account only. Password fields
 * are cleared after every submission so credentials are never redisplayed.
 */
export default function PasswordSettingsPage() {
  const { auth } = useSession();
  const needsAuth = auth.status !== 'ready' || !auth.user;
  useRedirectTo('#/signin', needsAuth);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<ChangePasswordErrors>({});
  const [updated, setUpdated] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (needsAuth) {
    return null;
  }

  function clearPasswords() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setErrors({});
    setUpdated(false);
    try {
      const result = await apiChangePassword({
        currentPassword,
        newPassword,
        confirmPassword,
      });
      if (result.ok) {
        setUpdated(true);
      } else {
        setErrors(result.errors);
      }
      clearPasswords();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="settings-page password-settings-page">
      <h1>Password and authentication</h1>
      {updated ? (
        <p role="status" className="success-message">
          Password updated
        </p>
      ) : null}
      <section className="change-password-section">
        <h2>Change password</h2>
        <p className="settings-intro">
          Update your account password.
        </p>
        <form className="account-access-form change-password-form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="password-current">Current password</label>
            <input
              id="password-current"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              aria-invalid={errors.currentPassword ? true : undefined}
              aria-describedby={errors.currentPassword ? 'password-current-error' : undefined}
            />
            {errors.currentPassword ? (
              <p id="password-current-error" className="field-error">
                {errors.currentPassword}
              </p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="password-new">New password</label>
            <input
              id="password-new"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              aria-invalid={errors.newPassword ? true : undefined}
              aria-describedby={errors.newPassword ? 'password-new-error' : undefined}
            />
            {errors.newPassword ? (
              <p id="password-new-error" className="field-error">
                {errors.newPassword}
              </p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="password-confirm">Confirm password</label>
            <input
              id="password-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={errors.confirmPassword ? true : undefined}
              aria-describedby={errors.confirmPassword ? 'password-confirm-error' : undefined}
            />
            {errors.confirmPassword ? (
              <p id="password-confirm-error" className="field-error">
                {errors.confirmPassword}
              </p>
            ) : null}
          </div>
          <button type="submit" className="primary-button" disabled={submitting}>
            Update password
          </button>
        </form>
      </section>
    </div>
  );
}

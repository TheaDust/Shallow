import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiChangePassword, isApiError } from '../api';
import type { FieldErrors } from '../validation';
import { validateChangePasswordForm } from '../validation';

export default function PasswordSettingsPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [updated, setUpdated] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function clearPasswords() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const errors = validateChangePasswordForm({
      currentPassword,
      newPassword,
      confirmPassword,
    });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      clearPasswords();
      return;
    }
    setSubmitting(true);
    try {
      await apiChangePassword({ currentPassword, newPassword, confirmPassword });
      setUpdated(true);
      setFieldErrors({});
      clearPasswords();
    } catch (err) {
      clearPasswords();
      if (isApiError(err) && err.status === 422) {
        setFieldErrors(err.body.fieldErrors || {});
      } else if (isApiError(err) && err.status === 401) {
        setFieldErrors({ form: 'Your session has expired. Please sign in again.' });
      } else {
        setFieldErrors({ form: 'Password update failed. Please try again.' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="settings-page">
      <h1>Password and authentication</h1>
      {updated && (
        <p className="status-success" role="status">
          Password updated
        </p>
      )}
      <form className="settings-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="change-current-password">Current password</label>
          <input
            id="change-current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            aria-invalid={Boolean(fieldErrors.currentPassword)}
            aria-describedby={
              fieldErrors.currentPassword ? 'change-current-password-error' : undefined
            }
          />
          {fieldErrors.currentPassword && (
            <p className="field-error" id="change-current-password-error">
              {fieldErrors.currentPassword}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="change-new-password">New password</label>
          <input
            id="change-new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            aria-invalid={Boolean(fieldErrors.newPassword)}
            aria-describedby={
              fieldErrors.newPassword ? 'change-new-password-error' : undefined
            }
          />
          {fieldErrors.newPassword && (
            <p className="field-error" id="change-new-password-error">
              {fieldErrors.newPassword}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="change-confirm-password">Confirm password</label>
          <input
            id="change-confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            aria-invalid={Boolean(fieldErrors.confirmPassword)}
            aria-describedby={
              fieldErrors.confirmPassword ? 'change-confirm-password-error' : undefined
            }
          />
          {fieldErrors.confirmPassword && (
            <p className="field-error" id="change-confirm-password-error">
              {fieldErrors.confirmPassword}
            </p>
          )}
        </div>

        {fieldErrors.form && (
          <p className="form-error" role="alert">
            {fieldErrors.form}
          </p>
        )}

        <button type="submit" className="primary-button" disabled={submitting}>
          Update password
        </button>
      </form>
      <p className="auth-switch">
        <a href="#/settings">Back to Settings</a>
      </p>
    </main>
  );
}

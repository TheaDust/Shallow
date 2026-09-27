import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, changePassword } from '../api';
import type { FieldErrors } from '../types';
import FieldError from '../components/FieldError';
import { useSession } from '../App';
import { navigate } from '../router';

// REQ-1-3: “Password and authentication” security page in account Settings.
// Only signed-in users may open it; signed-out visitors return home.
export default function PasswordAndAuthenticationPage() {
  const { user } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) navigate('#/');
  }, [user]);

  if (!user) return null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldErrors({});
    setSuccess(false);
    try {
      await changePassword({ currentPassword, newPassword, confirmPassword });
      setSuccess(true);
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors);
      } else {
        setFieldErrors({ form: 'Update failed' });
      }
    } finally {
      // Password fields must never echo entered values.
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Password and authentication</h1>
      {success && (
        <p role="status" className="success-message">
          Password updated
        </p>
      )}
      <div className="auth-box">
        <form className="auth-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className="field">
            <label htmlFor="current-password">Current password</label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              aria-describedby={fieldErrors.currentPassword ? 'current-password-error' : undefined}
              aria-invalid={fieldErrors.currentPassword ? true : undefined}
            />
            <FieldError id="current-password-error" message={fieldErrors.currentPassword} />
          </div>
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              aria-describedby={fieldErrors.newPassword ? 'new-password-error' : undefined}
              aria-invalid={fieldErrors.newPassword ? true : undefined}
            />
            <FieldError id="new-password-error" message={fieldErrors.newPassword} />
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Confirm password</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-describedby={
                fieldErrors.confirmPassword ? 'confirm-password-error' : undefined
              }
              aria-invalid={fieldErrors.confirmPassword ? true : undefined}
            />
            <FieldError id="confirm-password-error" message={fieldErrors.confirmPassword} />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            Update password
          </button>
        </form>
      </div>
      <p className="auth-links">
        <a href="#/settings">Back to settings</a>
      </p>
    </>
  );
}

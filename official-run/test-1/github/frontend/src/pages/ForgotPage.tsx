import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiForgotPassword, apiResetPassword, isApiError } from '../api';
import type { FieldErrors } from '../validation';
import { validateResetForm } from '../validation';

export default function ForgotPage() {
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [updated, setUpdated] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFieldErrors({});
    try {
      await apiForgotPassword(email);
      setStep('reset');
    } catch {
      setFieldErrors({ email: 'Recovery failed. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const errors = validateResetForm({ email, code, newPassword, confirmPassword });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setNewPassword('');
      setConfirmPassword('');
      return;
    }
    setSubmitting(true);
    try {
      await apiResetPassword({ email, code, newPassword, confirmPassword });
      setUpdated(true);
      setFieldErrors({});
      setCode('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setNewPassword('');
      setConfirmPassword('');
      if (isApiError(err) && err.status === 422) {
        setFieldErrors(err.body.fieldErrors || {});
      } else {
        setFieldErrors({ form: 'Password reset failed. Please try again.' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>Reset your password</h1>
        {updated ? (
          <p className="status-success" role="status">
            Password updated
          </p>
        ) : step === 'email' ? (
          <form onSubmit={handleSend} noValidate>
            <div className="field">
              <label htmlFor="forgot-email">Email</label>
              <input
                id="forgot-email"
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'forgot-email-error' : undefined}
              />
              {fieldErrors.email && (
                <p className="field-error" id="forgot-email-error">
                  {fieldErrors.email}
                </p>
              )}
            </div>
            <button type="submit" className="primary-button" disabled={submitting}>
              Send reset link
            </button>
          </form>
        ) : (
          <>
            <p className="code-hint">For local demonstration, your verification code is:</p>
            <div className="reset-code">123456</div>
            <form onSubmit={handleReset} noValidate>
              {fieldErrors.email && (
                <p className="form-error" role="alert">
                  {fieldErrors.email}
                </p>
              )}
              <div className="field">
                <label htmlFor="reset-code">Verification code</label>
                <input
                  id="reset-code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.code)}
                  aria-describedby={fieldErrors.code ? 'reset-code-error' : undefined}
                />
                {fieldErrors.code && (
                  <p className="field-error" id="reset-code-error">
                    {fieldErrors.code}
                  </p>
                )}
              </div>

              <div className="field">
                <label htmlFor="reset-new-password">New password</label>
                <input
                  id="reset-new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.newPassword)}
                  aria-describedby={
                    fieldErrors.newPassword ? 'reset-new-password-error' : undefined
                  }
                />
                {fieldErrors.newPassword && (
                  <p className="field-error" id="reset-new-password-error">
                    {fieldErrors.newPassword}
                  </p>
                )}
              </div>

              <div className="field">
                <label htmlFor="reset-confirm-password">Confirm password</label>
                <input
                  id="reset-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.confirmPassword)}
                  aria-describedby={
                    fieldErrors.confirmPassword ? 'reset-confirm-password-error' : undefined
                  }
                />
                {fieldErrors.confirmPassword && (
                  <p className="field-error" id="reset-confirm-password-error">
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
                Reset password
              </button>
            </form>
          </>
        )}
        <p className="auth-switch">
          <a href="#/signin">Sign in</a>
        </p>
      </div>
    </main>
  );
}

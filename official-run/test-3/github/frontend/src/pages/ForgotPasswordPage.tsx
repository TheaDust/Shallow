import { useState, type FormEvent } from 'react';
import { ApiError, recoverRequest, recoverReset } from '../api';
import type { FieldErrors } from '../types';
import FieldError from '../components/FieldError';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [displayCode, setDisplayCode] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldErrors({});
    try {
      const result = await recoverRequest(email);
      setDisplayCode(result.code);
      setStep('reset');
    } catch {
      setFieldErrors({ form: 'Request failed' });
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldErrors({});
    setSuccess(false);
    try {
      await recoverReset({ email, code, newPassword, confirmPassword });
      setSuccess(true);
      setCode('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors);
      } else {
        setFieldErrors({ form: 'Reset failed' });
      }
      // Password fields must not echo submitted values.
      setNewPassword('');
      setConfirmPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>{step === 'email' ? 'Forgot password' : 'Reset password'}</h1>
      {success && (
        <p role="status" className="success-message">
          Password updated
        </p>
      )}
      {step === 'email' ? (
        <div className="auth-box">
          <form className="auth-form" onSubmit={(e) => void handleRequest(e)} noValidate>
            <div className="field">
              <label htmlFor="recover-email">Email</label>
              <input
                id="recover-email"
                type="text"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              Send reset link
            </button>
          </form>
        </div>
      ) : (
        <>
          <p className="code-note">For local demonstration only, the verification code is:</p>
          <p className="verification-code">{displayCode}</p>
          <div className="auth-box">
            <form className="auth-form" onSubmit={(e) => void handleReset(e)} noValidate>
              <div className="field">
                <label htmlFor="recover-email">Email</label>
                <input
                  id="recover-email"
                  type="text"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-describedby={fieldErrors.email ? 'recover-email-error' : undefined}
                  aria-invalid={fieldErrors.email ? true : undefined}
                />
                <FieldError id="recover-email-error" message={fieldErrors.email} />
              </div>
              <div className="field">
                <label htmlFor="recover-code">Verification code</label>
                <input
                  id="recover-code"
                  type="text"
                  autoComplete="off"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  aria-describedby={fieldErrors.code ? 'recover-code-error' : undefined}
                  aria-invalid={fieldErrors.code ? true : undefined}
                />
                <FieldError id="recover-code-error" message={fieldErrors.code} />
              </div>
              <div className="field">
                <label htmlFor="recover-new-password">New password</label>
                <input
                  id="recover-new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  aria-describedby={
                    fieldErrors.newPassword ? 'recover-new-password-error' : undefined
                  }
                  aria-invalid={fieldErrors.newPassword ? true : undefined}
                />
                <FieldError id="recover-new-password-error" message={fieldErrors.newPassword} />
              </div>
              <div className="field">
                <label htmlFor="recover-confirm-password">Confirm password</label>
                <input
                  id="recover-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  aria-describedby={
                    fieldErrors.confirmPassword ? 'recover-confirm-password-error' : undefined
                  }
                  aria-invalid={fieldErrors.confirmPassword ? true : undefined}
                />
                <FieldError
                  id="recover-confirm-password-error"
                  message={fieldErrors.confirmPassword}
                />
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                Reset password
              </button>
            </form>
          </div>
        </>
      )}
      <p className="auth-links">
        <a href="#/signin">Back to sign in</a>
      </p>
    </>
  );
}

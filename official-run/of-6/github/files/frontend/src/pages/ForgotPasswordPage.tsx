import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiRecoveryRequest, apiRecoveryReset } from '../api';
import type { RecoveryErrors } from '../types';

/**
 * Password-recovery page (REQ-1-1-3 flow, opened by "Forgot password").
 *
 * Step 1 collects the email and always advances to step 2 with the fixed
 * local demonstration code "123456" for registered and unknown emails alike
 * (no account-existence disclosure). Step 2 keeps the Email field so every
 * reset error is explained beside its corresponding field; password fields are
 * never redisplayed after a failed submission.
 */
export default function ForgotPasswordPage() {
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<RecoveryErrors>({});
  const [updated, setUpdated] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSendResetLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    try {
      // The local system sends no email and calls no external service; both
      // registered and unknown addresses enter the same next step.
      await apiRecoveryRequest({ email });
      setStep('reset');
    } catch {
      setStep('reset');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    try {
      const result = await apiRecoveryReset({
        email,
        code,
        newPassword,
        confirmPassword,
      });
      if (!result.ok) {
        setErrors(result.errors);
        setNewPassword('');
        setConfirmPassword('');
        return;
      }
      setErrors({});
      setUpdated(true);
      setNewPassword('');
      setConfirmPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="account-access-page forgot-password-page">
      <h1>Forgot password?</h1>
      {updated ? (
        <p role="status" className="success-message">
          Password updated
        </p>
      ) : step === 'request' ? (
        <form className="account-access-form" onSubmit={handleSendResetLink} noValidate>
          <div className="field">
            <label htmlFor="forgot-email">Email</label>
            <input
              id="forgot-email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button type="submit" className="primary-button" disabled={submitting}>
            Send reset link
          </button>
        </form>
      ) : (
        <div className="recovery-step">
          <div className="demo-code">
            <p>For local demonstration only, your verification code is:</p>
            <p className="demo-code-value">123456</p>
          </div>
          <form className="account-access-form" onSubmit={handleResetPassword} noValidate>
            <div className="field">
              <label htmlFor="forgot-email">Email</label>
              <input
                id="forgot-email"
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? 'forgot-email-error' : undefined}
              />
              {errors.email ? (
                <p id="forgot-email-error" className="field-error">
                  {errors.email}
                </p>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="forgot-code">Verification code</label>
              <input
                id="forgot-code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                aria-invalid={errors.verificationCode ? true : undefined}
                aria-describedby={errors.verificationCode ? 'forgot-code-error' : undefined}
              />
              {errors.verificationCode ? (
                <p id="forgot-code-error" className="field-error">
                  {errors.verificationCode}
                </p>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="forgot-new-password">New password</label>
              <input
                id="forgot-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                aria-invalid={errors.newPassword ? true : undefined}
                aria-describedby={errors.newPassword ? 'forgot-new-password-error' : undefined}
              />
              {errors.newPassword ? (
                <p id="forgot-new-password-error" className="field-error">
                  {errors.newPassword}
                </p>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="forgot-confirm-password">Confirm password</label>
              <input
                id="forgot-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                aria-invalid={errors.confirmPassword ? true : undefined}
                aria-describedby={errors.confirmPassword ? 'forgot-confirm-password-error' : undefined}
              />
              {errors.confirmPassword ? (
                <p id="forgot-confirm-password-error" className="field-error">
                  {errors.confirmPassword}
                </p>
              ) : null}
            </div>
            <button type="submit" className="primary-button" disabled={submitting}>
              Reset password
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

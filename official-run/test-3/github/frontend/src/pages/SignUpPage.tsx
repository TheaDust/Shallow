import { useState, type FormEvent } from 'react';
import { ApiError, register } from '../api';
import type { FieldErrors } from '../types';
import { navigate } from '../router';
import FieldError from '../components/FieldError';

export default function SignUpPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldErrors({});
    try {
      await register({ username, email, password, confirmPassword, agreeToTerms });
      // Registration success: store kept the verified account, redirect to sign-in.
      navigate('#/signin?created=1');
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors);
      } else {
        setFieldErrors({ form: 'Registration failed' });
      }
      // Password fields must not redisplay submitted values.
      setPassword('');
      setConfirmPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Create account</h1>
      <div className="auth-box">
        <form className="auth-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className="field">
            <label htmlFor="signup-username">Username</label>
            <input
              id="signup-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-describedby={fieldErrors.username ? 'signup-username-error' : undefined}
              aria-invalid={fieldErrors.username ? true : undefined}
            />
            <FieldError id="signup-username-error" message={fieldErrors.username} />
          </div>
          <div className="field">
            <label htmlFor="signup-email">Email</label>
            <input
              id="signup-email"
              type="text"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-describedby={fieldErrors.email ? 'signup-email-error' : undefined}
              aria-invalid={fieldErrors.email ? true : undefined}
            />
            <FieldError id="signup-email-error" message={fieldErrors.email} />
          </div>
          <div className="field">
            <label htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={fieldErrors.password ? 'signup-password-error' : undefined}
              aria-invalid={fieldErrors.password ? true : undefined}
            />
            <FieldError id="signup-password-error" message={fieldErrors.password} />
          </div>
          <div className="field">
            <label htmlFor="signup-confirm-password">Confirm password</label>
            <input
              id="signup-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-describedby={
                fieldErrors.confirmPassword ? 'signup-confirm-password-error' : undefined
              }
              aria-invalid={fieldErrors.confirmPassword ? true : undefined}
            />
            <FieldError id="signup-confirm-password-error" message={fieldErrors.confirmPassword} />
          </div>
          <div className="field checkbox-field">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={agreeToTerms}
                onChange={(e) => setAgreeToTerms(e.target.checked)}
                aria-describedby={
                  fieldErrors.agreeToTerms ? 'signup-terms-error' : undefined
                }
                aria-invalid={fieldErrors.agreeToTerms ? true : undefined}
              />
              Agree to the terms
            </label>
            <FieldError id="signup-terms-error" message={fieldErrors.agreeToTerms} />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            Create account
          </button>
        </form>
      </div>
      <p className="auth-links">
        Already have an account? <a href="#/signin">Sign in</a>
      </p>
    </>
  );
}

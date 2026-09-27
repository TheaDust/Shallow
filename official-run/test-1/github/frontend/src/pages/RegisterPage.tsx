import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiRegister, isApiError } from '../api';
import type { FieldErrors } from '../validation';
import { validateRegisterForm } from '../validation';
import { navigate } from '../router';

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [terms, setTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const errors = validateRegisterForm({
      username,
      email,
      password,
      confirmPassword,
      terms,
    });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setPassword('');
      setConfirmPassword('');
      return;
    }
    setSubmitting(true);
    try {
      await apiRegister({
        username,
        email,
        password,
        confirmPassword,
        terms,
      });
      navigate('/signin?registered=1');
    } catch (err) {
      setPassword('');
      setConfirmPassword('');
      if (isApiError(err) && err.status === 422) {
        setFieldErrors(err.body.fieldErrors || {});
      } else {
        setFieldErrors({ form: 'Registration failed. Please try again.' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>Sign up to GitHub</h1>
        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="register-username">Username</label>
            <input
              id="register-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-invalid={Boolean(fieldErrors.username)}
              aria-describedby={fieldErrors.username ? 'register-username-error' : undefined}
            />
            {fieldErrors.username && (
              <p className="field-error" id="register-username-error">
                {fieldErrors.username}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="register-email">Email</label>
            <input
              id="register-email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? 'register-email-error' : undefined}
            />
            {fieldErrors.email && (
              <p className="field-error" id="register-email-error">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="register-password">Password</label>
            <input
              id="register-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? 'register-password-error' : undefined}
            />
            {fieldErrors.password && (
              <p className="field-error" id="register-password-error">
                {fieldErrors.password}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="register-confirm-password">Confirm password</label>
            <input
              id="register-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={Boolean(fieldErrors.confirmPassword)}
              aria-describedby={
                fieldErrors.confirmPassword ? 'register-confirm-password-error' : undefined
              }
            />
            {fieldErrors.confirmPassword && (
              <p className="field-error" id="register-confirm-password-error">
                {fieldErrors.confirmPassword}
              </p>
            )}
          </div>

          <div className="field checkbox-field">
            <input
              id="register-terms"
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              aria-invalid={Boolean(fieldErrors.terms)}
              aria-describedby={fieldErrors.terms ? 'register-terms-error' : undefined}
            />
            <label htmlFor="register-terms">Agree to the terms</label>
            {fieldErrors.terms && (
              <p className="field-error" id="register-terms-error">
                {fieldErrors.terms}
              </p>
            )}
          </div>

          {fieldErrors.form && (
            <p className="form-error" role="alert">
              {fieldErrors.form}
            </p>
          )}

          <button type="submit" className="primary-button" disabled={submitting}>
            Create account
          </button>
        </form>
        <p className="auth-switch">
          Already have an account? <a href="#/signin">Sign in</a>
        </p>
      </div>
    </main>
  );
}

import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiRegister } from '../api';
import { navigate } from '../router';
import type { RegisterErrors } from '../types';

/**
 * Registration page opened by the unique link "Create an account" from the
 * sign-in page (REQ-1-1-1). Field errors come from the server so that all
 * violated rules are shown together; username/email are retained on failure,
 * password fields are always cleared.
 */
export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [errors, setErrors] = useState<RegisterErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setErrors({});
    try {
      const result = await apiRegister({
        username,
        email,
        password,
        confirmPassword,
        agreeToTerms,
      });
      if (result.ok) {
        setUsername('');
        setEmail('');
        setPassword('');
        setConfirmPassword('');
        setAgreeToTerms(false);
        sessionStorage.setItem('registerSuccess', '1');
        navigate('#/signin');
      } else {
        setErrors(result.errors);
        setPassword('');
        setConfirmPassword('');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="account-access-page register-page">
      <h1>Create your account</h1>
      <form className="account-access-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="register-username">Username</label>
          <input
            id="register-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-describedby={errors.username ? 'register-username-error' : undefined}
            aria-invalid={errors.username ? true : undefined}
          />
          {errors.username ? (
            <p id="register-username-error" className="field-error">
              {errors.username}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="register-email">Email</label>
          <input
            id="register-email"
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby={errors.email ? 'register-email-error' : undefined}
            aria-invalid={errors.email ? true : undefined}
          />
          {errors.email ? (
            <p id="register-email-error" className="field-error">
              {errors.email}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="register-password">Password</label>
          <input
            id="register-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={errors.password ? 'register-password-error' : undefined}
            aria-invalid={errors.password ? true : undefined}
          />
          {errors.password ? (
            <p id="register-password-error" className="field-error">
              {errors.password}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="register-confirm-password">Confirm password</label>
          <input
            id="register-confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            aria-describedby={errors.confirmPassword ? 'register-confirm-password-error' : undefined}
            aria-invalid={errors.confirmPassword ? true : undefined}
          />
          {errors.confirmPassword ? (
            <p id="register-confirm-password-error" className="field-error">
              {errors.confirmPassword}
            </p>
          ) : null}
        </div>

        <div className="field field-checkbox">
          <label htmlFor="register-terms" className="terms-label">
            <input
              id="register-terms"
              type="checkbox"
              checked={agreeToTerms}
              onChange={(e) => setAgreeToTerms(e.target.checked)}
              aria-describedby={errors.agreeToTerms ? 'register-terms-error' : undefined}
              aria-invalid={errors.agreeToTerms ? true : undefined}
            />
            Agree to the terms
          </label>
          {errors.agreeToTerms ? (
            <p id="register-terms-error" className="field-error">
              {errors.agreeToTerms}
            </p>
          ) : null}
        </div>

        <button type="submit" className="primary-button" disabled={submitting}>
          Create account
        </button>
      </form>
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { apiSignIn } from '../api';
import { navigate } from '../router';
import { useSession } from '../session';

/**
 * Sign-in page of the account-access page. After a successful registration it
 * also shows the "Registration successful" confirmation (REQ-1-1-1).
 */
export default function SignInPage() {
  const { updateUser } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('registerSuccess')) {
      sessionStorage.removeItem('registerSuccess');
      setSuccessMessage('Registration successful');
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const result = await apiSignIn({ identifier, password });
      if (!result.ok) {
        setError(result.message);
        setPassword('');
        return;
      }
      setPassword('');
      updateUser({ username: result.username, email: result.email });
      navigate('#/workspace');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="account-access-page sign-in-page">
      <h1>Sign in to GitHub</h1>
      {successMessage ? (
        <p role="status" className="success-message">
          {successMessage}
        </p>
      ) : null}
      <form className="account-access-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="signin-identifier">Username or email</label>
          <input
            id="signin-identifier"
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="signin-password">Password</label>
          <input
            id="signin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
        <button type="submit" className="primary-button" disabled={submitting}>
          Sign in
        </button>
      </form>
      <div className="account-access-links">
        <a href="#/register">Create an account</a>
        <a href="#/forgot">Forgot password</a>
      </div>
    </div>
  );
}

import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiSignIn, isApiError } from '../api';
import type { User } from '../api';
import { useRoute } from '../router';

export default function SignInPage({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const route = useRoute();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const registered = route.query.get('registered') === '1';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await apiSignIn(identifier, password);
      onSignedIn(result.user);
    } catch (err) {
      setPassword('');
      if (isApiError(err) && err.status === 401) {
        setError('Invalid credentials');
      } else {
        setError('Sign in failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>Sign in to GitHub</h1>
        {registered && (
          <p className="status-success" role="status">
            Registration successful. Please sign in.
          </p>
        )}
        <form onSubmit={handleSubmit} noValidate>
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

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="primary-button" disabled={submitting}>
            Sign in
          </button>
        </form>
        <p className="auth-switch">
          <a href="#/forgot">Forgot password</a>
        </p>
        <p className="auth-switch">
          New to GitHub? <a href="#/register">Create an account</a>
        </p>
      </div>
    </main>
  );
}

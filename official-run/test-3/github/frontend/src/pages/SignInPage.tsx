import { useState, type FormEvent } from 'react';
import { ApiError, signIn } from '../api';
import { navigate, useHashRoute } from '../router';
import { useSession } from '../App';

export default function SignInPage() {
  const { refresh } = useSession();
  const route = useHashRoute();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const created = route.search.get('created') === '1';

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError('');
    try {
      const result = await signIn(identifier, password);
      await refresh();
      if (result.user) navigate('#/');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setFormError('Invalid credentials');
      } else if (error instanceof ApiError) {
        setFormError(error.message || 'Sign in failed');
      } else {
        setFormError('Sign in failed');
      }
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Sign in to GitHub</h1>
      {created && (
        <p role="status" className="success-message">
          Registration successful
        </p>
      )}
      <div className="auth-box">
        <form className="auth-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className="field">
            <label htmlFor="signin-identifier">Username or email</label>
            <input
              id="signin-identifier"
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="signin-password">Password</label>
            <input
              id="signin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {formError && (
            <p role="alert" className="form-error">
              {formError}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            Sign in
          </button>
        </form>
      </div>
      <p className="auth-links">
        <a href="#/forgot-password">Forgot password</a>
      </p>
      <p className="auth-links">
        New to GitHub? <a href="#/signup">Create an account</a>
      </p>
    </>
  );
}

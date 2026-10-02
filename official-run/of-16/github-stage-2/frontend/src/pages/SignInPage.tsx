import { useState, type FormEvent } from "react";

import { errorMessageOf } from "../auth/api";
import { useSession } from "../auth/SessionContext";
import { navigate } from "../lib/hash-route";
import { Button, FormField } from "../ui";

const GENERIC_FAILURE = "Invalid credentials";

/**
 * Sign-in form of the account-access page. Authentication failures always show
 * the same generic message, whether the account is unknown or the password is
 * wrong, and never create a session.
 */
export function SignInPage() {
  const { signIn } = useSession();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(identifier, password);
      navigate("/");
    } catch (failure) {
      setError(errorMessageOf(failure) ?? GENERIC_FAILURE);
      // Passwords are never echoed back into the page after a failure.
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page page--narrow">
      <h1>Sign in to your account</h1>
      <form className="app-form" aria-label="Sign in" noValidate onSubmit={handleSubmit}>
        <FormField id="signin-identifier" label="Username or email">
          <input
            id="signin-identifier"
            name="identifier"
            type="text"
            autoComplete="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
          />
        </FormField>
        <FormField id="signin-password" label="Password">
          <input
            id="signin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </FormField>
        {error ? (
          <p className="app-form__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="app-form__actions">
          <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
            Sign in
          </Button>
        </div>
      </form>
      <p className="page__links">
        <a href="#/forgot-password">Forgot password</a>
        <span aria-hidden="true"> · </span>
        <a href="#/signup">Create an account</a>
      </p>
    </section>
  );
}

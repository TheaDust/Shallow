import { useState, type ChangeEvent, type FormEvent } from "react";

import { useAuth } from "../auth/AuthProvider";
import { signInAccount } from "../lib/accounts-api";
import { navigate, useHashLocation } from "../lib/hash-route";
import { Button, FormField } from "../ui";

/** Sign-in form of the shared account-access page. */
export function SignInPage() {
  const { setAccount } = useAuth();
  const location = useHashLocation();
  const justRegistered = location.search.get("registered") === "1";
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const updateIdentifier = (event: ChangeEvent<HTMLInputElement>) => setIdentifier(event.target.value);
  const updatePassword = (event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);
    // The attempted value is captured so that the failure never discards a
    // password the visitor typed while this request was still in flight.
    const attemptedPassword = password;
    const result = await signInAccount(identifier, attemptedPassword);
    setSubmitting(false);
    if (result.ok) {
      setAccount(result.account);
      navigate("/workspace");
      return;
    }
    setPassword((current) => (current === attemptedPassword ? "" : current));
    setMessage(result.message);
  }

  return (
    <main>
      <h1>Sign in</h1>
      {justRegistered ? (
        <p role="status" className="form-message form-message--success">
          Registration successful. You can now sign in.
        </p>
      ) : null}
      {message ? (
        <p role="alert" className="form-message form-message--error">
          {message}
        </p>
      ) : null}
      <form className="auth-form" noValidate onSubmit={handleSubmit}>
        <FormField id="signin-identifier" label="Username or email">
          <input
            id="signin-identifier"
            name="identifier"
            type="text"
            autoComplete="username"
            value={identifier}
            onChange={updateIdentifier}
          />
        </FormField>
        <FormField id="signin-password" label="Password">
          <input
            id="signin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={updatePassword}
          />
        </FormField>
        <Button type="submit" variant="primary" disabled={submitting}>
          Sign in
        </Button>
      </form>
      <p className="auth-switch">
        <a href="#/signup">Create an account</a>
      </p>
      <p className="auth-switch">
        <a href="#/password-reset">Forgot password</a>
      </p>
    </main>
  );
}

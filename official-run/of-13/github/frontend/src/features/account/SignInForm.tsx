import { useState, type FormEvent } from "react";

import { navigate, useHashLocation } from "../../lib/hash-route";
import { messageOf } from "../../lib/session-api";
import { Button, FormField } from "../../ui";
import { useAccountSession } from "./AccountSession";

export function SignInForm() {
  const { signIn } = useAccountSession();
  const location = useHashLocation();
  const registrationNotice = location.search.get("registered") === "1";

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await signIn(identifier, password);
      setPassword("");
      navigate("/dashboard");
    } catch (error) {
      setFailure(messageOf(error, "Unable to sign in right now. Please try again."));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-access__view">
      <h1>Sign in to GitHub</h1>
      {registrationNotice ? (
        <p className="form-status" role="status">
          Account created successfully.
        </p>
      ) : null}
      {failure ? (
        <p className="form-error" role="alert">
          {failure}
        </p>
      ) : null}
      <form className="account-form" noValidate onSubmit={handleSubmit}>
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
        <Button type="submit" variant="primary" disabled={busy}>
          Sign in
        </Button>
      </form>
      <p className="account-access__aside">
        <a href="#/signup">Create an account</a>
      </p>
      <p className="account-access__aside">
        <a href="#/forgot-password">Forgot password</a>
      </p>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from "react";

import { Button, FormField } from "../ui";
import { navigate } from "../lib/hash-route";
import { signIn } from "../lib/session-api";
import { useSession } from "../session/session-context";

export function SignInPage() {
  const { setAccount } = useSession();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  // Navigate once the session state has committed, so the protected workspace
  // never observes a stale, unauthenticated snapshot.
  useEffect(() => {
    if (authenticated) navigate("/workspace");
  }, [authenticated]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const account = await signIn(identifier, password);
      setAccount(account);
      setAuthenticated(true);
    } catch {
      // One generic message for unknown accounts, wrong passwords and
      // unavailable accounts so the page never discloses which failed.
      setError("Invalid credentials");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <main>
        <h1>Sign in</h1>
        <form className="auth-form" noValidate onSubmit={handleSubmit}>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
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
        <div className="auth-links">
          <a href="#/signup">Create an account</a>
          <a href="#/recover">Forgot password</a>
        </div>
      </main>
    </div>
  );
}

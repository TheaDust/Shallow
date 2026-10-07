import { useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";
import { signIn } from "../lib/auth-api";
import { navigate } from "../lib/hash-route";
import { useSession } from "../lib/session";

export function SignInPage() {
  const { setUser } = useSession();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await signIn(identifier, password);
      if (result.ok) {
        setUser(result.user);
        setBusy(false);
        navigate("/");
        return;
      }
      setError(result.message);
      // A rejected sign-in keeps the identifier but never echoes the password.
      setPassword("");
    } catch {
      setError("Unable to sign in. Please try again.");
    }
    setBusy(false);
  };

  return (
    <main className="page">
      <section className="page__body auth">
        <h1 className="auth__title">Sign in to GitHub</h1>
        <form className="auth__form" onSubmit={handleSubmit} noValidate>
          {error ? (
            <p className="auth__error" role="alert">
              {error}
            </p>
          ) : null}
          <FormField id="sign-in-identifier" label="Username or email">
            <input
              id="sign-in-identifier"
              name="identifier"
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
            />
          </FormField>
          <FormField id="sign-in-password" label="Password">
            <input
              id="sign-in-password"
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
        <p className="auth__switch">
          <a href="#/sign-up">Create an account</a>
        </p>
        <p className="auth__switch">
          <a href="#/forgot-password">Forgot password</a>
        </p>
      </section>
    </main>
  );
}

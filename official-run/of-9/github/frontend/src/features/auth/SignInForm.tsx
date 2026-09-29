import { useState, type FormEvent } from "react";

import { navigate, useHashLocation } from "../../lib/hash-route";
import { Button, FormField } from "../../ui";
import { signIn } from "./api";
import { useSession } from "./session";

export function SignInForm() {
  const location = useHashLocation();
  const { refreshSession } = useSession();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const registered = location.search.get("registered") === "1";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await signIn({ identifier, password });
      if (result.ok) {
        await refreshSession();
        navigate("/");
      } else {
        setError(result.message);
        setPassword("");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="account-access">
      {registered ? (
        <p role="status" className="account-access__notice">
          Account created successfully. You can now sign in.
        </p>
      ) : null}
      <h1>Sign in</h1>
      <form className="account-access__form" onSubmit={submit} noValidate>
        {error ? (
          <p role="alert" className="account-access__error">
            {error}
          </p>
        ) : null}
        <FormField id="signin-identifier" label="Username or email">
          <input
            id="signin-identifier"
            type="text"
            autoComplete="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
          />
        </FormField>
        <FormField id="signin-password" label="Password">
          <input
            id="signin-password"
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
      <nav className="account-access__links" aria-label="Account access">
        <a href="#/forgot-password">Forgot password</a>
        <a href="#/signup">Create an account</a>
      </nav>
    </section>
  );
}

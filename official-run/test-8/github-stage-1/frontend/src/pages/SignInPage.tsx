import { useState, type FormEvent } from "react";

import { useAuth } from "../auth/AuthProvider";
import { makeHash, navigate } from "../lib/hash-route";
import { Button, FormField } from "../ui";

export function SignInPage() {
  const { signIn } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await signIn(identifier, password);
    setPending(false);
    setPassword("");
    if (!result.ok) {
      setError(result.message ?? "Invalid credentials");
      return;
    }
    navigate("/");
  };

  return (
    <main>
      <h1>Sign in to GitHub</h1>
      <form className="account-form" aria-label="Sign in" noValidate onSubmit={(event) => void submit(event)}>
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
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={pending}>
          Sign in
        </Button>
      </form>
      <p>
        <a href={makeHash("/forgot")}>Forgot password</a>
      </p>
      <p>
        New to GitHub? <a href={makeHash("/signup")}>Create an account</a>
      </p>
      <p>
        <a href={makeHash("/")}>Home</a>
      </p>
    </main>
  );
}

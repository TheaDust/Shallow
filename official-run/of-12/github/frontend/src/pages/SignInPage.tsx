import { useState, type FormEvent } from "react";

import { Button, FormField } from "../ui";
import { navigate, useHashLocation } from "../lib/hash-route";
import { clearFormFields, readFormValues } from "../lib/forms";
import { useSession } from "../lib/session";
import { AuthPage } from "./AuthPage";

export function SignInPage() {
  const location = useHashLocation();
  const createdUsername = location.search.get("created");
  const { signIn } = useSession();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = readFormValues(form, ["identifier", "password"]);
    setIdentifier(values.identifier);
    setPassword("");
    clearFormFields(form, ["password"]);
    setError(null);
    // signIn commits the session before returning, so leaving for the workspace
    // here is durable even if the page is reloaded immediately afterwards.
    const result = signIn(values.identifier, values.password);
    if (result.ok) {
      navigate("/workspace");
      return;
    }
    setError(result.message);
  };

  return (
    <AuthPage title="Welcome back">
      {createdUsername ? (
        <p className="auth-page__notice" role="status">
          Account created for {createdUsername}. Sign in with your new account.
        </p>
      ) : null}
      <form className="auth-form" onSubmit={onSubmit} noValidate>
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
        {error ? <p className="auth-form__error" role="alert">{error}</p> : null}
        <Button type="submit" variant="primary">
          Sign in
        </Button>
      </form>
      <nav className="auth-page__links">
        <a href="#/register">Create an account</a>
        <a href="#/forgot-password">Forgot password</a>
      </nav>
    </AuthPage>
  );
}

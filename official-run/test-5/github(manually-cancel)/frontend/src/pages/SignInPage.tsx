import { useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";
import { navigate } from "../lib/hash-route";
import { forgetRegisteredIdentifier, peekRegisteredIdentifier } from "../auth/pending-signin";
import { useSession } from "../session/SessionProvider";
import { signIn } from "../session/session-api";

export interface SignInPageProps {
  /** Set right after a successful registration so the page can confirm it. */
  justRegistered: boolean;
}

/**
 * REQ-1-1-2: the sign-in form of the shared account-access page. Every failure
 * (unknown account, wrong password, unavailable account) produces the same
 * generic message and never echoes the submitted password. When the visitor
 * arrives here straight from a successful registration (REQ-1-1-1) the field
 * starts with the username of the account that was just created.
 */
export function SignInPage({ justRegistered }: SignInPageProps) {
  const { setAccount } = useSession();
  const [identifier, setIdentifier] = useState(() =>
    justRegistered ? peekRegisteredIdentifier() ?? "" : "",
  );
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const result = await signIn(identifier, password);
      if (result.ok) {
        setAccount(result.account);
        setPassword("");
        forgetRegisteredIdentifier();
        navigate("/");
        return;
      }
      setFailure(result.error);
    } catch {
      setFailure("Unable to sign in. Please try again.");
    } finally {
      // The submitted password value must not be redisplayed after a failure.
      setPassword("");
      setSubmitting(false);
    }
  };

  return (
    <main>
      <h1>Sign in</h1>
      {justRegistered ? <p role="status">Account created successfully</p> : null}
      <form className="auth-form" onSubmit={onSubmit} noValidate>
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
        {failure ? (
          <p className="auth-form__error" role="alert">
            {failure}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={submitting}>
          Sign in
        </Button>
      </form>
      <p>
        <a href="#/forgot-password">Forgot password</a>
      </p>
      <p>
        <a href="#/signup">Create an account</a>
      </p>
    </main>
  );
}

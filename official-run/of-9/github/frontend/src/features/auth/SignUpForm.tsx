import { useState, type FormEvent } from "react";

import { navigate } from "../../lib/hash-route";
import { Button, FormField } from "../../ui";
import { registerAccount, type FieldErrors } from "./api";

export function SignUpForm() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    try {
      const result = await registerAccount({ username, email, password, confirmPassword, agreeToTerms });
      if (result.ok) {
        navigate("/signin", new URLSearchParams({ registered: "1" }));
      } else {
        setErrors(result.errors);
        setPassword("");
        setConfirmPassword("");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="account-access">
      <h1>Create your account</h1>
      <form className="account-access__form" onSubmit={submit} noValidate>
        <FormField id="signup-username" label="Username" error={errors.username}>
          <input
            id="signup-username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </FormField>
        <FormField id="signup-email" label="Email" error={errors.email}>
          <input
            id="signup-email"
            type="text"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>
        <FormField id="signup-password" label="Password" error={errors.password}>
          <input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </FormField>
        <FormField id="signup-confirm-password" label="Confirm password" error={errors.confirmPassword}>
          <input
            id="signup-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </FormField>
        <div className="ui-field" data-invalid={Boolean(errors.terms) || undefined}>
          <label htmlFor="signup-terms" className="account-access__terms">
            <input
              id="signup-terms"
              type="checkbox"
              checked={agreeToTerms}
              onChange={(event) => setAgreeToTerms(event.target.checked)}
            />
            Agree to the terms
          </label>
          {errors.terms ? (
            <p role="alert" className="ui-field__error">
              {errors.terms}
            </p>
          ) : null}
        </div>
        <Button type="submit" variant="primary" disabled={busy}>
          Create account
        </Button>
      </form>
      <nav className="account-access__links" aria-label="Account access">
        <a href="#/signin">Sign in</a>
      </nav>
    </section>
  );
}

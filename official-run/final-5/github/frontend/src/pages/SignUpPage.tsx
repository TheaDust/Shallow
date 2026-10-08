import { useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";
import { registerAccount, type FieldErrors } from "../lib/auth-api";
import { navigate } from "../lib/hash-route";

export function SignUpPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await registerAccount({
        username,
        email,
        password,
        confirmPassword,
        agreeToTerms,
      });
      if (result.ok) {
        setBusy(false);
        navigate("/sign-in");
        return;
      }
      setErrors(result.fieldErrors);
      // The username and email stay for correction; secrets are never re-shown.
      setPassword("");
      setConfirmPassword("");
    } catch {
      setMessage("Unable to create the account. Please try again.");
    }
    setBusy(false);
  };

  return (
    <main className="page">
      <section className="page__body auth">
        <h1 className="auth__title">Create your account</h1>
        {message ? (
          <p className="auth__error" role="alert">
            {message}
          </p>
        ) : null}
        <form className="auth__form" onSubmit={handleSubmit} noValidate>
          <FormField id="sign-up-username" label="Username" error={errors.username}>
            <input
              id="sign-up-username"
              name="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </FormField>
          <FormField id="sign-up-email" label="Email" error={errors.email}>
            <input
              id="sign-up-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>
          <FormField id="sign-up-password" label="Password" error={errors.password}>
            <input
              id="sign-up-password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </FormField>
          <FormField
            id="sign-up-confirm-password"
            label="Confirm password"
            error={errors.confirmPassword}
          >
            <input
              id="sign-up-confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </FormField>
          <FormField id="sign-up-terms" label="Agree to the terms" error={errors.terms}>
            <input
              id="sign-up-terms"
              name="agreeToTerms"
              type="checkbox"
              checked={agreeToTerms}
              onChange={(event) => setAgreeToTerms(event.target.checked)}
            />
          </FormField>
          <Button type="submit" variant="primary" disabled={busy}>
            Create account
          </Button>
        </form>
      </section>
    </main>
  );
}

import { useState, type FormEvent } from "react";

import { errorMessageOf, fieldErrorsOf, registerAccount } from "../auth/api";
import type { FieldErrors } from "../auth/types";
import { navigate } from "../lib/hash-route";
import { Button, FormField, fieldDescriptionIds } from "../ui";

const FALLBACK_ERROR = "We could not create your account. Try again.";

/**
 * Registration form of the account-access page. Every field is validated on the
 * server, which returns one message per failing field so a single submission
 * shows the username, email, password and terms problems together.
 */
export function SignUpPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      await registerAccount({ username, email, password, confirmPassword, agreeToTerms });
      navigate("/login");
    } catch (failure) {
      const fieldErrors = fieldErrorsOf(failure);
      if (fieldErrors) {
        setErrors(fieldErrors);
      } else {
        setFormError(errorMessageOf(failure) ?? FALLBACK_ERROR);
      }
      // Username and email are kept so they can be corrected; password values
      // are never echoed back into the page.
      setPassword("");
      setConfirmPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page page--narrow">
      <h1>Create your account</h1>
      <form className="app-form" aria-label="Create account" noValidate onSubmit={handleSubmit}>
        <FormField id="signup-username" label="Username" error={errors.username}>
          <input
            id="signup-username"
            name="username"
            type="text"
            autoComplete="username"
            aria-describedby={fieldDescriptionIds("signup-username", { error: Boolean(errors.username) })}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </FormField>
        <FormField id="signup-email" label="Email" error={errors.email}>
          <input
            id="signup-email"
            name="email"
            type="email"
            autoComplete="email"
            aria-describedby={fieldDescriptionIds("signup-email", { error: Boolean(errors.email) })}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>
        <FormField id="signup-password" label="Password" error={errors.password}>
          <input
            id="signup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            aria-describedby={fieldDescriptionIds("signup-password", { error: Boolean(errors.password) })}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </FormField>
        <FormField id="signup-confirm-password" label="Confirm password" error={errors.confirmPassword}>
          <input
            id="signup-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-describedby={fieldDescriptionIds("signup-confirm-password", { error: Boolean(errors.confirmPassword) })}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </FormField>
        <div className="app-field app-field--checkbox" data-invalid={Boolean(errors.agreeToTerms) || undefined}>
          <input
            id="signup-terms"
            name="agreeToTerms"
            type="checkbox"
            checked={agreeToTerms}
            aria-describedby={errors.agreeToTerms ? "signup-terms-error" : undefined}
            onChange={(event) => setAgreeToTerms(event.target.checked)}
          />
          <label htmlFor="signup-terms">Agree to the terms</label>
          {errors.agreeToTerms ? (
            <p id="signup-terms-error" className="ui-field__error" role="alert">
              {errors.agreeToTerms}
            </p>
          ) : null}
        </div>
        {formError ? (
          <p className="app-form__error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="app-form__actions">
          <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
            Create account
          </Button>
        </div>
      </form>
    </section>
  );
}

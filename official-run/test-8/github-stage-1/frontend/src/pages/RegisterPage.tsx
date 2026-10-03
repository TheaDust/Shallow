import { useState, type FormEvent } from "react";

import { fieldErrorsOf, messageOf, registerAccount, type FieldErrors } from "../api/auth";
import { makeHash, navigate } from "../lib/hash-route";
import { Button, FormField } from "../ui";

export function RegisterPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await registerAccount({ username, email, password, confirmPassword, agreeToTerms: agreedToTerms });
      navigate("/signin");
    } catch (error) {
      const fields = fieldErrorsOf(error);
      if (Object.keys(fields).length > 0) setErrors(fields);
      else setFormError(messageOf(error, "Registration failed"));
    } finally {
      // Passwords must never be echoed back into the page.
      setPassword("");
      setConfirmPassword("");
      setPending(false);
    }
  };

  return (
    <main>
      <h1>Create your account</h1>
      <form className="account-form" aria-label="Create account" noValidate onSubmit={(event) => void submit(event)}>
        <FormField id="register-username" label="Username" error={errors.username}>
          <input
            id="register-username"
            name="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </FormField>
        <FormField id="register-email" label="Email" error={errors.email}>
          <input
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>
        <FormField id="register-password" label="Password" error={errors.password}>
          <input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </FormField>
        <FormField id="register-confirm-password" label="Confirm password" error={errors.confirmPassword}>
          <input
            id="register-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </FormField>
        <div className="ui-field">
          <label className="ui-checkbox" htmlFor="register-terms">
            <input
              id="register-terms"
              name="terms"
              type="checkbox"
              checked={agreedToTerms}
              onChange={(event) => setAgreedToTerms(event.target.checked)}
            />
            <span>Agree to the terms</span>
          </label>
          {errors.terms ? (
            <p className="ui-field__error" role="alert">
              {errors.terms}
            </p>
          ) : null}
        </div>
        {formError ? (
          <p className="form-error" role="alert">
            {formError}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={pending}>
          Create account
        </Button>
      </form>
      <p>
        Already have an account? <a href={makeHash("/signin")}>Sign in</a>
      </p>
      <p>
        <a href={makeHash("/")}>Home</a>
      </p>
    </main>
  );
}

import { useState, type ChangeEvent, type FormEvent } from "react";

import { registerAccount, type FieldErrors } from "../lib/accounts-api";
import { navigate } from "../lib/hash-route";
import { Button, FormField } from "../ui";

interface RegistrationValues {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}

const EMPTY_VALUES: RegistrationValues = { username: "", email: "", password: "", confirmPassword: "" };

/** Registration form of the shared account-access page. */
export function SignUpPage() {
  const [values, setValues] = useState<RegistrationValues>(EMPTY_VALUES);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [fields, setFields] = useState<FieldErrors>({});
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (key: keyof RegistrationValues) => (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    setValues((current) => ({ ...current, [key]: value }));
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormMessage(null);
    const attempted = values;
    const result = await registerAccount({ ...attempted, termsAccepted });
    setSubmitting(false);
    if (result.ok) {
      navigate("/signin", new URLSearchParams({ registered: "1" }));
      return;
    }
    setFields(result.fields);
    setFormMessage(Object.keys(result.fields).length > 0 ? null : result.message);
    // Non-sensitive input is retained, submitted passwords are never redisplayed;
    // a password re-typed during the request is kept.
    setValues((current) => ({
      ...current,
      password: current.password === attempted.password ? "" : current.password,
      confirmPassword: current.confirmPassword === attempted.confirmPassword ? "" : current.confirmPassword,
    }));
  }

  return (
    <main>
      <h1>Create your account</h1>
      {formMessage ? (
        <p role="alert" className="form-message form-message--error">
          {formMessage}
        </p>
      ) : null}
      <form className="auth-form" noValidate onSubmit={handleSubmit}>
        <FormField id="signup-username" label="Username" error={fields.username}>
          <input
            id="signup-username"
            name="username"
            type="text"
            autoComplete="username"
            value={values.username}
            onChange={update("username")}
          />
        </FormField>
        <FormField id="signup-email" label="Email" error={fields.email}>
          <input
            id="signup-email"
            name="email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={update("email")}
          />
        </FormField>
        <FormField id="signup-password" label="Password" error={fields.password}>
          <input
            id="signup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={values.password}
            onChange={update("password")}
          />
        </FormField>
        <FormField id="signup-confirm-password" label="Confirm password" error={fields.confirmPassword}>
          <input
            id="signup-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={values.confirmPassword}
            onChange={update("confirmPassword")}
          />
        </FormField>
        <FormField id="signup-terms" label="Agree to the terms" error={fields.terms}>
          <input
            id="signup-terms"
            name="terms"
            type="checkbox"
            checked={termsAccepted}
            onChange={(event) => setTermsAccepted(event.target.checked)}
          />
        </FormField>
        <Button type="submit" variant="primary" disabled={submitting}>
          Create account
        </Button>
      </form>
    </main>
  );
}

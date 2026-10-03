import { useState, type FormEvent } from "react";

import { Button, FormField } from "../ui";
import { ApiError } from "../lib/api";
import { navigate } from "../lib/hash-route";
import { registerAccount } from "../lib/session-api";

type FieldErrors = Partial<Record<"username" | "email" | "password" | "confirmPassword" | "terms" | "form", string>>;

interface SignUpValues {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  agreeToTerms: boolean;
}

const EMPTY_VALUES: SignUpValues = {
  username: "",
  email: "",
  password: "",
  confirmPassword: "",
  agreeToTerms: false,
};

function extractErrors(caught: unknown): FieldErrors {
  if (caught instanceof ApiError && caught.body && typeof caught.body === "object" && "errors" in caught.body) {
    return (caught.body as { errors: FieldErrors }).errors;
  }
  return { form: "Unable to create the account. Please try again." };
}

export function SignUpPage() {
  const [values, setValues] = useState<SignUpValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  function update<K extends keyof SignUpValues>(key: K, value: SignUpValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await registerAccount(values);
      navigate("/signin");
    } catch (caught) {
      setErrors(extractErrors(caught));
      // Passwords never reappear on the page after a rejected submission.
      setValues((current) => ({ ...current, password: "", confirmPassword: "" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <main>
        <h1>Create an account</h1>
        <form className="auth-form" noValidate onSubmit={handleSubmit}>
          {errors.form ? (
            <p className="form-error" role="alert">
              {errors.form}
            </p>
          ) : null}
          <FormField id="signup-username" label="Username" error={errors.username}>
            <input
              id="signup-username"
              name="username"
              type="text"
              autoComplete="username"
              value={values.username}
              onChange={(event) => update("username", event.target.value)}
            />
          </FormField>
          <FormField id="signup-email" label="Email" error={errors.email}>
            <input
              id="signup-email"
              name="email"
              type="text"
              autoComplete="email"
              value={values.email}
              onChange={(event) => update("email", event.target.value)}
            />
          </FormField>
          <FormField id="signup-password" label="Password" error={errors.password}>
            <input
              id="signup-password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={values.password}
              onChange={(event) => update("password", event.target.value)}
            />
          </FormField>
          <FormField id="signup-confirm-password" label="Confirm password" error={errors.confirmPassword}>
            <input
              id="signup-confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={values.confirmPassword}
              onChange={(event) => update("confirmPassword", event.target.value)}
            />
          </FormField>
          <div className="check-field">
            <label htmlFor="signup-terms">
              <input
                id="signup-terms"
                name="agreeToTerms"
                type="checkbox"
                checked={values.agreeToTerms}
                onChange={(event) => update("agreeToTerms", event.target.checked)}
              />
              Agree to the terms
            </label>
            {errors.terms ? (
              <p className="ui-field__error" id="signup-terms-error" role="alert">
                {errors.terms}
              </p>
            ) : null}
          </div>
          <Button type="submit" variant="primary" disabled={busy}>
            Create account
          </Button>
        </form>
      </main>
    </div>
  );
}

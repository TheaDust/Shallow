import { useState, type ChangeEvent, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";
import { navigate } from "../lib/hash-route";
import {
  hasErrors,
  validateRegistration,
  type RegistrationErrors,
  type RegistrationValues,
} from "../auth/validation";
import { rememberRegisteredIdentifier } from "../auth/pending-signin";
import { registerAccount } from "../session/session-api";

const EMPTY_VALUES: RegistrationValues = {
  username: "",
  email: "",
  password: "",
  confirmPassword: "",
  agreeToTerms: false,
};

/**
 * REQ-1-1-1: the registration form opened from the “Create an account” link.
 * Every invalid field is reported beside its input in the same submission, the
 * username/email are retained, and password fields never redisplay a value.
 * While the account is being created the whole form is disabled, so the
 * submission cannot be repeated and no later action can target these fields
 * during the hand-off to the sign-in page.
 */
export function RegisterPage() {
  const [values, setValues] = useState<RegistrationValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field: keyof RegistrationValues) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setValues((current) => ({ ...current, [field]: value }));
  };

  const clearPasswords = () =>
    setValues((current) => ({ ...current, password: "", confirmPassword: "" }));

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const clientErrors = validateRegistration(values);
    if (hasErrors(clientErrors)) {
      setFormError(null);
      setErrors(clientErrors);
      clearPasswords();
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await registerAccount(values);
      if (result.ok) {
        // The sign-in page starts with the account created by this submission.
        rememberRegisteredIdentifier(result.account.username);
        navigate("/login", new URLSearchParams({ registered: "1" }));
        return;
      }
      setErrors(result.errors);
      clearPasswords();
    } catch {
      setFormError("Unable to create the account. Please try again.");
      clearPasswords();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main>
      <h1>Create your account</h1>
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <FormField id="register-username" label="Username" error={errors.username}>
          <input
            id="register-username"
            name="username"
            type="text"
            autoComplete="username"
            value={values.username}
            onChange={update("username")}
            disabled={submitting}
          />
        </FormField>
        <FormField id="register-email" label="Email" error={errors.email}>
          <input
            id="register-email"
            name="email"
            type="text"
            autoComplete="email"
            value={values.email}
            onChange={update("email")}
            disabled={submitting}
          />
        </FormField>
        <FormField id="register-password" label="Password" error={errors.password}>
          <input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={values.password}
            onChange={update("password")}
            disabled={submitting}
          />
        </FormField>
        <FormField
          id="register-confirm-password"
          label="Confirm password"
          error={errors.confirmPassword}
        >
          <input
            id="register-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={values.confirmPassword}
            onChange={update("confirmPassword")}
            disabled={submitting}
          />
        </FormField>
        <div className="auth-checkbox" data-invalid={errors.terms ? "" : undefined}>
          <input
            id="register-terms"
            name="agreeToTerms"
            type="checkbox"
            checked={values.agreeToTerms}
            onChange={update("agreeToTerms")}
            disabled={submitting}
          />
          <label htmlFor="register-terms">Agree to the terms</label>
          {errors.terms ? (
            <p id="register-terms-error" className="ui-field__error" role="alert">
              {errors.terms}
            </p>
          ) : null}
        </div>
        {formError ? (
          <p className="auth-form__error" role="alert">
            {formError}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={submitting}>
          Create account
        </Button>
      </form>
    </main>
  );
}

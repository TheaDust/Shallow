import { useRef, useState, type FormEvent } from "react";

import { Button, FormField } from "../ui";
import { registerAccount, type RegistrationFieldErrors, type RegistrationInput } from "../features/auth/auth-api";
import { navigate } from "../lib/hash-route";
import { clearFormFields, readFormChecked, readFormValues } from "../lib/forms";
import { AuthPage } from "./AuthPage";

const EMPTY_FORM: RegistrationInput = {
  username: "",
  email: "",
  password: "",
  confirmPassword: "",
  agreeToTerms: false,
};

export function RegisterPage() {
  const [form, setForm] = useState<RegistrationInput>(EMPTY_FORM);
  const [errors, setErrors] = useState<RegistrationFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const update = <Key extends keyof RegistrationInput>(key: Key, value: RegistrationInput[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    const values = readFormValues(form, ["username", "email", "password", "confirmPassword"]);
    const agreeToTerms = readFormChecked(form, "agreeToTerms");
    // Non-sensitive input is retained; submitted passwords are never redisplayed.
    setForm({
      username: values.username,
      email: values.email,
      password: "",
      confirmPassword: "",
      agreeToTerms,
    });
    clearFormFields(form, ["password", "confirmPassword"]);
    inFlight.current = true;
    setBusy(true);
    setFormError(null);
    try {
      const result = await registerAccount({
        username: values.username,
        email: values.email,
        password: values.password,
        confirmPassword: values.confirmPassword,
        agreeToTerms,
      });
      if (result.ok) {
        navigate("/sign-in", new URLSearchParams({ created: values.username }));
        return;
      }
      setErrors(result.errors);
      setFormError(result.message ?? null);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <AuthPage title="Create your account">
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <FormField id="register-username" label="Username" error={errors.username}>
          <input
            id="register-username"
            name="username"
            type="text"
            autoComplete="username"
            value={form.username}
            onChange={(event) => update("username", event.target.value)}
          />
        </FormField>
        <FormField id="register-email" label="Email" error={errors.email}>
          <input
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(event) => update("email", event.target.value)}
          />
        </FormField>
        <FormField id="register-password" label="Password" error={errors.password}>
          <input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(event) => update("password", event.target.value)}
          />
        </FormField>
        <FormField id="register-confirm-password" label="Confirm password" error={errors.confirmPassword}>
          <input
            id="register-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={(event) => update("confirmPassword", event.target.value)}
          />
        </FormField>
        <FormField id="register-terms" label="Agree to the terms" error={errors.terms}>
          <input
            id="register-terms"
            name="agreeToTerms"
            type="checkbox"
            checked={form.agreeToTerms}
            onChange={(event) => update("agreeToTerms", event.target.checked)}
          />
        </FormField>
        {formError ? <p className="auth-form__error" role="alert">{formError}</p> : null}
        <Button type="submit" variant="primary" disabled={busy}>
          Create account
        </Button>
        <p className="auth-form__aside">
          Already have an account? <a href="#/sign-in">Sign in</a>
        </p>
      </form>
    </AuthPage>
  );
}

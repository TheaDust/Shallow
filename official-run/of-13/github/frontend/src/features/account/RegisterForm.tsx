import { useState, type FormEvent } from "react";

import { navigate } from "../../lib/hash-route";
import { fieldErrorsOf, messageOf, registerAccount, type FieldErrors } from "../../lib/session-api";
import { Button, FormField, fieldDescriptionIds } from "../../ui";

const EMPTY_FIELDS = {
  username: "",
  email: "",
  password: "",
  confirmPassword: "",
};

export function RegisterForm() {
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update(field: keyof typeof EMPTY_FIELDS) {
    return (event: { target: { value: string } }) => {
      setFields((current) => ({ ...current, [field]: event.target.value }));
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await registerAccount({ ...fields, agreeToTerms });
      // Passwords never travel back to the page once the account exists.
      setFields((current) => ({ ...current, password: "", confirmPassword: "" }));
      navigate("/login", new URLSearchParams({ registered: "1" }));
    } catch (error) {
      const errors = fieldErrorsOf(error);
      setFieldErrors(errors);
      // The username and email stay visible so the visitor can correct them,
      // while both password inputs are emptied.
      setFields((current) => ({ ...current, password: "", confirmPassword: "" }));
      if (Object.keys(errors).length === 0) {
        setFailure(messageOf(error, "Unable to create the account right now. Please try again."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-access__view">
      <h1>Create your account</h1>
      {failure ? (
        <p className="form-error" role="alert">
          {failure}
        </p>
      ) : null}
      <form className="account-form" noValidate onSubmit={handleSubmit}>
        <FormField
          id="register-username"
          label="Username"
          error={fieldErrors.username}
        >
          <input
            id="register-username"
            name="username"
            type="text"
            autoComplete="username"
            aria-describedby={fieldDescriptionIds("register-username", {
              error: Boolean(fieldErrors.username),
            })}
            value={fields.username}
            onChange={update("username")}
          />
        </FormField>
        <FormField id="register-email" label="Email" error={fieldErrors.email}>
          <input
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            aria-describedby={fieldDescriptionIds("register-email", {
              error: Boolean(fieldErrors.email),
            })}
            value={fields.email}
            onChange={update("email")}
          />
        </FormField>
        <FormField id="register-password" label="Password" error={fieldErrors.password}>
          <input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            aria-describedby={fieldDescriptionIds("register-password", {
              error: Boolean(fieldErrors.password),
            })}
            value={fields.password}
            onChange={update("password")}
          />
        </FormField>
        <FormField
          id="register-confirm-password"
          label="Confirm password"
          error={fieldErrors.confirmPassword}
        >
          <input
            id="register-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-describedby={fieldDescriptionIds("register-confirm-password", {
              error: Boolean(fieldErrors.confirmPassword),
            })}
            value={fields.confirmPassword}
            onChange={update("confirmPassword")}
          />
        </FormField>
        <div className="account-form__checkbox">
          <label htmlFor="agree-to-terms">
            <input
              id="agree-to-terms"
              name="agreeToTerms"
              type="checkbox"
              checked={agreeToTerms}
              aria-describedby={fieldErrors.agreeToTerms ? "agree-to-terms-error" : undefined}
              onChange={(event) => setAgreeToTerms(event.target.checked)}
            />
            Agree to the terms
          </label>
          {fieldErrors.agreeToTerms ? (
            <p id="agree-to-terms-error" className="ui-field__error" role="alert">
              {fieldErrors.agreeToTerms}
            </p>
          ) : null}
        </div>
        <Button type="submit" variant="primary" disabled={busy}>
          Create account
        </Button>
      </form>
      <p className="account-access__aside">
        <a href="#/login">Sign in</a>
      </p>
    </div>
  );
}

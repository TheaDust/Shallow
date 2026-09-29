import { useState, type ChangeEvent, type FormEvent } from "react";

import { RECOVERY_CODE, EMAIL_MESSAGES, type PasswordResetErrors } from "../auth/validation";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";
import { resetPassword } from "../session/session-api";

type ResetStep = "request" | "reset" | "done";

interface ResetValues {
  code: string;
  newPassword: string;
  confirmPassword: string;
}

const EMPTY_VALUES: ResetValues = { code: "", newPassword: "", confirmPassword: "" };

/**
 * REQ-1-1-3: the password-recovery page opened by the “Forgot password” link of
 * the sign-in page. Registered and unknown addresses reach the same second step
 * with the same fixed local code, and only a valid code with a compliant,
 * confirmed new password changes the credentials of a registered account.
 */
export function PasswordResetPage() {
  const [step, setStep] = useState<ResetStep>("request");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [values, setValues] = useState<ResetValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<PasswordResetErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field: keyof ResetValues) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setValues((current) => ({ ...current, [field]: value }));
  };

  const onRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim()) {
      setEmailError(EMAIL_MESSAGES.format);
      return;
    }
    setEmailError(null);
    setStep("reset");
  };

  // A failed submission must never redisplay a submitted password value.
  const clearPasswordFields = () =>
    setValues((current) => ({ ...current, newPassword: "", confirmPassword: "" }));

  const onReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await resetPassword({ email, ...values });
      if (result.ok) {
        setErrors({});
        clearPasswordFields();
        setStep("done");
        return;
      }
      setErrors(result.errors);
      clearPasswordFields();
    } catch {
      setFormError("Unable to reset the password. Please try again.");
      clearPasswordFields();
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "done") {
    return (
      <main>
        <h1>Reset your password</h1>
        <p role="status">Password updated</p>
      </main>
    );
  }

  if (step === "reset") {
    return (
      <main>
        <h1>Reset your password</h1>
        <p>No email is sent in this local demonstration. Use the verification code below.</p>
        <p className="recovery-code">{RECOVERY_CODE}</p>
        <form className="auth-form" onSubmit={onReset} noValidate>
          <FormField id="reset-email" label="Email" error={errors.email}>
            <input
              id="reset-email"
              name="email"
              type="text"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>
          <FormField id="reset-code" label="Verification code" error={errors.code}>
            <input
              id="reset-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={values.code}
              onChange={update("code")}
            />
          </FormField>
          <FormField id="reset-new-password" label="New password" error={errors.newPassword}>
            <input
              id="reset-new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              value={values.newPassword}
              onChange={update("newPassword")}
            />
          </FormField>
          <FormField
            id="reset-confirm-password"
            label="Confirm password"
            error={errors.confirmPassword}
          >
            <input
              id="reset-confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={values.confirmPassword}
              onChange={update("confirmPassword")}
            />
          </FormField>
          {formError ? (
            <p className="auth-form__error" role="alert">
              {formError}
            </p>
          ) : null}
          <Button type="submit" variant="primary" disabled={submitting}>
            Reset password
          </Button>
        </form>
      </main>
    );
  }

  return (
    <main>
      <h1>Reset your password</h1>
      <p>Enter the email of your account to start the recovery flow.</p>
      <form className="auth-form" onSubmit={onRequest} noValidate>
        <FormField id="recovery-email" label="Email" error={emailError ?? undefined}>
          <input
            id="recovery-email"
            name="email"
            type="text"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>
        <Button type="submit" variant="primary">
          Send reset link
        </Button>
      </form>
    </main>
  );
}

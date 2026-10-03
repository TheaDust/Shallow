import { useEffect, useState, type FormEvent } from "react";

import {
  fieldErrorsOf,
  messageOf,
  requestPasswordRecovery,
  resetPassword,
  type FieldErrors,
} from "../api/auth";
import { makeHash, navigate, useHashLocation } from "../lib/hash-route";
import { Button, FormField } from "../ui";

function RequestResetStep() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await requestPasswordRecovery(email);
      navigate("/forgot/reset", new URLSearchParams({ email: result.email || email }));
    } catch (requestError) {
      setError(messageOf(requestError, "Password recovery is unavailable"));
    } finally {
      setPending(false);
    }
  };

  return (
    <main>
      <h1>Reset your password</h1>
      <form
        className="account-form"
        aria-label="Password recovery"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <FormField id="recovery-email" label="Email">
          <input
            id="recovery-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={pending}>
          Send reset link
        </Button>
      </form>
      <p>
        <a href={makeHash("/signin")}>Sign in</a>
      </p>
      <p>
        <a href={makeHash("/")}>Home</a>
      </p>
    </main>
  );
}

function ResetPasswordStep({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [verificationCode, setVerificationCode] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    requestPasswordRecovery(initialEmail)
      .then((result) => {
        if (!cancelled) setVerificationCode(result.verificationCode);
      })
      .catch(() => {
        if (!cancelled) setVerificationCode("");
      });
    return () => {
      cancelled = true;
    };
  }, [initialEmail]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    setStatus(null);
    try {
      const result = await resetPassword({ email, code, newPassword, confirmPassword });
      setStatus(result.message);
    } catch (error) {
      const fields = fieldErrorsOf(error);
      if (Object.keys(fields).length > 0) setErrors(fields);
      else setFormError(messageOf(error, "Password reset failed"));
    } finally {
      setNewPassword("");
      setConfirmPassword("");
      setPending(false);
    }
  };

  return (
    <main>
      <h1>Reset your password</h1>
      <p>Use this code to confirm the reset:</p>
      <p className="recovery-code">
        <code>{verificationCode}</code>
      </p>
      <form
        className="account-form"
        aria-label="Reset password"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <FormField id="reset-email" label="Email" error={errors.email}>
          <input
            id="reset-email"
            name="email"
            type="email"
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
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </FormField>
        <FormField id="reset-new-password" label="New password" error={errors.password}>
          <input
            id="reset-new-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </FormField>
        <FormField id="reset-confirm-password" label="Confirm password" error={errors.confirmPassword}>
          <input
            id="reset-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </FormField>
        {formError ? (
          <p className="form-error" role="alert">
            {formError}
          </p>
        ) : null}
        {status ? (
          <p className="form-status" role="status">
            {status}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={pending}>
          Reset password
        </Button>
      </form>
      <p>
        <a href={makeHash("/signin")}>Sign in</a>
      </p>
      <p>
        <a href={makeHash("/")}>Home</a>
      </p>
    </main>
  );
}

export function ForgotPasswordPage() {
  const location = useHashLocation();
  const email = location.search.get("email") ?? "";
  if (location.path === "/forgot/reset") return <ResetPasswordStep initialEmail={email} />;
  return <RequestResetStep />;
}

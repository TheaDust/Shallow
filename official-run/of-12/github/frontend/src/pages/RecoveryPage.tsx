import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button, FormField } from "../ui";
import {
  completePasswordRecovery,
  requestPasswordRecovery,
  type RecoveryFieldErrors,
} from "../features/auth/auth-api";
import { navigate, useHashLocation } from "../lib/hash-route";
import { clearFormFields, readFormValues } from "../lib/forms";
import { useSession } from "../lib/session";
import { AuthPage } from "./AuthPage";

/**
 * Password recovery (REQ-1-1-3). Step one takes the account email; step two
 * shows the fixed local demonstration code and the reset form. Registered and
 * unknown addresses reach the identical next step, and the local product never
 * sends email or generates a reset link.
 */
export function RecoveryPage() {
  const location = useHashLocation();
  const updated = location.search.get("updated") === "1";
  const { refresh } = useSession();
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [demoCode, setDemoCode] = useState("123456");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<RecoveryFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const showingResult = useRef(updated);

  // Leaving the success view restarts the flow with an empty form. State is
  // only rewritten on that transition, never while the form is being filled.
  useEffect(() => {
    const leftResultView = showingResult.current && !updated;
    showingResult.current = updated;
    if (!leftResultView) return;
    setStep("email");
    setEmail("");
    setCode("");
    setPassword("");
    setConfirmPassword("");
    setErrors({});
    setFormError(null);
  }, [updated]);

  const requestCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    const values = readFormValues(form, ["email"]);
    setEmail(values.email);
    inFlight.current = true;
    setBusy(true);
    setFormError(null);
    setErrors({});
    try {
      const result = await requestPasswordRecovery(values.email);
      if (!result.ok) {
        setFormError(result.message ?? null);
        return;
      }
      // Registered and unknown addresses see the same fixed demonstration code.
      setDemoCode(result.code ?? "123456");
      setStep("reset");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const submitReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    const values = readFormValues(form, ["email", "code", "password", "confirmPassword"]);
    // Non-sensitive input is retained; submitted passwords are never redisplayed.
    setEmail(values.email);
    setCode(values.code);
    setPassword("");
    setConfirmPassword("");
    clearFormFields(form, ["password", "confirmPassword"]);
    inFlight.current = true;
    setBusy(true);
    setFormError(null);
    try {
      const result = await completePasswordRecovery({
        email: values.email,
        code: values.code,
        password: values.password,
        confirmPassword: values.confirmPassword,
      });
      if (!result.ok) {
        setErrors(result.errors);
        setFormError(result.message ?? null);
        return;
      }
      setErrors({});
      // The credential change ends sessions opened with the replaced password.
      await refresh();
      navigate("/forgot-password", new URLSearchParams({ updated: "1" }));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (updated) {
    return (
      <AuthPage title="Reset your password">
        <p className="auth-page__notice" role="status">
          Password updated
        </p>
      </AuthPage>
    );
  }

  if (step === "reset") {
    return (
      <AuthPage title="Reset your password">
        <p className="auth-page__message">
          No email is sent by this local product. Use the demonstration verification code shown below.
        </p>
        <p className="auth-page__code">{demoCode}</p>
        <form className="auth-form" onSubmit={submitReset} noValidate>
          <FormField id="recovery-email" label="Email" error={errors.email}>
            <input
              id="recovery-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>
          <FormField id="recovery-code" label="Verification code" error={errors.code}>
            <input
              id="recovery-code"
              name="code"
              type="text"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </FormField>
          <FormField id="recovery-password" label="New password" error={errors.password}>
            <input
              id="recovery-password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </FormField>
          <FormField
            id="recovery-confirm-password"
            label="Confirm password"
            error={errors.confirmPassword}
          >
            <input
              id="recovery-confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </FormField>
          {formError ? <p className="auth-form__error" role="alert">{formError}</p> : null}
          <Button type="submit" variant="primary" disabled={busy}>
            Reset password
          </Button>
        </form>
      </AuthPage>
    );
  }

  return (
    <AuthPage title="Reset your password">
      <p className="auth-page__message">
        Enter your account email to continue password recovery.
      </p>
      <form className="auth-form" onSubmit={requestCode} noValidate>
        <FormField id="recovery-email" label="Email" error={errors.email}>
          <input
            id="recovery-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>
        {formError ? <p className="auth-form__error" role="alert">{formError}</p> : null}
        <Button type="submit" variant="primary" disabled={busy}>
          Send reset link
        </Button>
      </form>
      <nav className="auth-page__links">
        <a href="#/sign-in">Sign in</a>
      </nav>
    </AuthPage>
  );
}

import { useState } from "react";

import { requestRecovery, resetPassword } from "../../lib/account-api";
import { FieldErrors } from "../../lib/account-api";

type Step = "email" | "reset";

export function RecoveryForm() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [token, setToken] = useState("");
  const [shownCode, setShownCode] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [updated, setUpdated] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSendResetLink(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setErrors({});
    setSubmitting(true);
    try {
      const result = await requestRecovery(email);
      setToken(result.token);
      setShownCode(result.code);
      setStep("reset");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setErrors({});
    setSubmitting(true);
    try {
      const result = await resetPassword({ token, code, newPassword, confirmPassword });
      if (!result.ok) {
        setErrors(result.errors);
        setNewPassword("");
        setConfirmPassword("");
        return;
      }
      setUpdated(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (updated) {
    return (
      <p className="account-form__status" role="status">
        Password updated
      </p>
    );
  }

  if (step === "email") {
    return (
      <form className="account-form" onSubmit={(event) => void handleSendResetLink(event)}>
        <div className="account-form__field">
          <label htmlFor="recovery-email">Email</label>
          <input
            id="recovery-email"
            type="text"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
        </div>
        <button type="submit" className="button button--primary" disabled={submitting}>
          Send reset link
        </button>
        <div className="account-form__links">
          <a href="#/signin">Sign in</a>
        </div>
      </form>
    );
  }

  return (
    <form className="account-form" onSubmit={(event) => void handleResetPassword(event)}>
      <p className="account-form__code" data-testid="recovery-code">
        {shownCode}
      </p>
      <div className="account-form__field">
        <label htmlFor="recovery-code-input">Verification code</label>
        <input
          id="recovery-code-input"
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          aria-describedby={errors.code ? "recovery-code-error" : undefined}
        />
        {errors.code && (
          <p className="account-form__error" id="recovery-code-error">
            {errors.code}
          </p>
        )}
      </div>
      <div className="account-form__field">
        <label htmlFor="recovery-new-password">New password</label>
        <input
          id="recovery-new-password"
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          aria-describedby={errors.password ? "recovery-password-error" : undefined}
          autoComplete="new-password"
        />
        {errors.password && (
          <p className="account-form__error" id="recovery-password-error">
            {errors.password}
          </p>
        )}
      </div>
      <div className="account-form__field">
        <label htmlFor="recovery-confirm-password">Confirm password</label>
        <input
          id="recovery-confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          aria-describedby={errors.confirmPassword ? "recovery-confirm-password-error" : undefined}
          autoComplete="new-password"
        />
        {errors.confirmPassword && (
          <p className="account-form__error" id="recovery-confirm-password-error">
            {errors.confirmPassword}
          </p>
        )}
      </div>
      {errors.email && (
        <p className="account-form__error" role="alert">
          {errors.email}
        </p>
      )}
      <button type="submit" className="button button--primary" disabled={submitting}>
        Reset password
      </button>
      <div className="account-form__links">
        <a href="#/signin">Sign in</a>
      </div>
    </form>
  );
}

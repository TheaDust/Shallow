import { useState } from "react";

import { registerAccount } from "../../lib/account-api";
import { FieldErrors } from "../../lib/account-api";
import { navigate } from "../../lib/hash-route";

export function SignUpForm() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setErrors({});
    setSubmitting(true);
    try {
      const result = await registerAccount({
        username,
        email,
        password,
        confirmPassword,
        agreeToTerms,
      });
      if (!result.ok) {
        setErrors(result.errors);
        setPassword("");
        setConfirmPassword("");
        return;
      }
      sessionStorage.setItem("registration-success", "1");
      navigate("/signin");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="account-form" onSubmit={(event) => void handleSubmit(event)}>
      <div className="account-form__field">
        <label htmlFor="signup-username">Username</label>
        <input
          id="signup-username"
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          aria-describedby={errors.username ? "signup-username-error" : undefined}
          autoComplete="username"
        />
        {errors.username && (
          <p className="account-form__error" id="signup-username-error">
            {errors.username}
          </p>
        )}
      </div>
      <div className="account-form__field">
        <label htmlFor="signup-email">Email</label>
        <input
          id="signup-email"
          type="text"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-describedby={errors.email ? "signup-email-error" : undefined}
          autoComplete="email"
        />
        {errors.email && (
          <p className="account-form__error" id="signup-email-error">
            {errors.email}
          </p>
        )}
      </div>
      <div className="account-form__field">
        <label htmlFor="signup-password">Password</label>
        <input
          id="signup-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby={errors.password ? "signup-password-error" : undefined}
          autoComplete="new-password"
        />
        {errors.password && (
          <p className="account-form__error" id="signup-password-error">
            {errors.password}
          </p>
        )}
      </div>
      <div className="account-form__field">
        <label htmlFor="signup-confirm-password">Confirm password</label>
        <input
          id="signup-confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          aria-describedby={errors.confirmPassword ? "signup-confirm-password-error" : undefined}
          autoComplete="new-password"
        />
        {errors.confirmPassword && (
          <p className="account-form__error" id="signup-confirm-password-error">
            {errors.confirmPassword}
          </p>
        )}
      </div>
      <div className="account-form__field account-form__field--check">
        <label className="account-form__checkbox">
          <input
            type="checkbox"
            checked={agreeToTerms}
            onChange={(event) => setAgreeToTerms(event.target.checked)}
          />
          Agree to the terms
        </label>
        {errors.terms && (
          <p className="account-form__error" id="signup-terms-error">
            {errors.terms}
          </p>
        )}
      </div>
      <button type="submit" className="button button--primary" disabled={submitting}>
        Create account
      </button>
      <div className="account-form__links">
        <a href="#/signin">Sign in</a>
      </div>
    </form>
  );
}

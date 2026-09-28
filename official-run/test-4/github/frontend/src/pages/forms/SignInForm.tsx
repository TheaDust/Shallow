import { useState } from "react";

import { useSession } from "../../session";
import { navigate } from "../../lib/hash-route";

export function SignInForm() {
  const { signIn } = useSession();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [registered] = useState(() => {
    const flag = sessionStorage.getItem("registration-success");
    if (flag) sessionStorage.removeItem("registration-success");
    return flag === "1";
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await signIn(identifier, password);
      if (!result.ok) {
        setError(result.message);
        setPassword("");
        return;
      }
      navigate("/");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="account-form" onSubmit={(event) => void handleSubmit(event)}>
      {registered && (
        <p className="account-form__status" role="status">
          Registration successful
        </p>
      )}
      <div className="account-form__field">
        <label htmlFor="signin-identifier">Username or email</label>
        <input
          id="signin-identifier"
          type="text"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          autoComplete="username"
        />
      </div>
      <div className="account-form__field">
        <label htmlFor="signin-password">Password</label>
        <input
          id="signin-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
      </div>
      {error && (
        <p className="account-form__error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="button button--primary" disabled={submitting}>
        Sign in
      </button>
      <div className="account-form__links">
        <a href="#/signup">Create an account</a>
        <a href="#/recover">Forgot password</a>
      </div>
    </form>
  );
}

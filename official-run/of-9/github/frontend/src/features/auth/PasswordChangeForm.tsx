import { useState, type FormEvent } from "react";

import { Button, FormField } from "../../ui";
import { changePassword, type FieldErrors } from "./api";

export function PasswordChangeForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setUpdated(false);
    try {
      const result = await changePassword({ currentPassword, newPassword, confirmPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      if (result.ok) {
        setUpdated(true);
      } else {
        setErrors(result.errors);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="account-access__form" onSubmit={submit} noValidate>
      {updated ? (
        <p role="status" className="account-access__notice">
          Password updated
        </p>
      ) : null}
      <FormField id="password-current" label="Current password" error={errors.currentPassword}>
        <input
          id="password-current"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </FormField>
      <FormField id="password-new" label="New password" error={errors.newPassword}>
        <input
          id="password-new"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
      </FormField>
      <FormField id="password-confirm" label="Confirm password" error={errors.confirmPassword}>
        <input
          id="password-confirm"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
      </FormField>
      <Button type="submit" variant="primary" disabled={busy}>
        Update password
      </Button>
    </form>
  );
}

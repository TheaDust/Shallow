import { useState, type FormEvent } from "react";

import {
  changePasswordRequest,
  fieldErrorsOf,
  messageOf,
  type FieldErrors,
} from "../../lib/session-api";
import { Button, FormField, fieldDescriptionIds } from "../../ui";

/**
 * Security form used to change the credentials of the current account. It only
 * talks to the authenticated password endpoint; the server decides whether the
 * change is allowed.
 */
export function PasswordChangeForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Password updated");
  const [updated, setUpdated] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    setFieldErrors({});
    setUpdated(false);
    try {
      const message = await changePasswordRequest({
        currentPassword,
        newPassword,
        confirmPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setStatusMessage(message || "Password updated");
      setUpdated(true);
    } catch (error) {
      const errors = fieldErrorsOf(error);
      setFieldErrors(errors);
      if (Object.keys(errors).length === 0) {
        setFailure(messageOf(error, "Unable to update the password right now. Please try again."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="password-settings">
      {updated ? (
        <p className="form-status" role="status">
          {statusMessage || "Password updated"}
        </p>
      ) : null}
      {failure ? (
        <p className="form-error" role="alert">
          {failure}
        </p>
      ) : null}
      <form className="account-form" noValidate onSubmit={handleSubmit}>
        <FormField
          id="current-password"
          label="Current password"
          error={fieldErrors.currentPassword}
        >
          <input
            id="current-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            aria-describedby={fieldDescriptionIds("current-password", {
              error: Boolean(fieldErrors.currentPassword),
            })}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </FormField>
        <FormField id="new-password" label="New password" error={fieldErrors.newPassword}>
          <input
            id="new-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            aria-describedby={fieldDescriptionIds("new-password", {
              error: Boolean(fieldErrors.newPassword),
            })}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </FormField>
        <FormField
          id="confirm-password"
          label="Confirm password"
          error={fieldErrors.confirmPassword}
        >
          <input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-describedby={fieldDescriptionIds("confirm-password", {
              error: Boolean(fieldErrors.confirmPassword),
            })}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </FormField>
        <Button type="submit" variant="primary" disabled={busy}>
          Update password
        </Button>
      </form>
    </div>
  );
}

import { useId, useState } from "react";

import type { RepositoryVisibility } from "../../lib/organizations-api";
import {
  changeRepositoryVisibility,
  fieldErrorsOf,
  type RepositoryRecord,
} from "../../lib/repositories-api";
import { messageOf } from "../../lib/session-api";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { FormField } from "../../ui/FormField";

export interface RepositoryVisibilityChoicesProps {
  legend: string;
  name: string;
  value: RepositoryVisibility;
  onChange(value: RepositoryVisibility): void;
  disabled?: boolean;
}

/**
 * The `Public` / `Private` radio controls of the visibility workflow. The
 * Danger Zone and its confirmation dialog never show both instances at once:
 * the confirmation replaces the section controls while it is open.
 */
export function RepositoryVisibilityChoices({
  legend,
  name,
  value,
  onChange,
  disabled,
}: RepositoryVisibilityChoicesProps) {
  return (
    <fieldset className="repository-visibility-choices">
      <legend>{legend}</legend>
      <label>
        <input
          type="radio"
          name={name}
          value="public"
          checked={value === "public"}
          disabled={disabled}
          onChange={() => onChange("public")}
        />
        Public
      </label>
      <label>
        <input
          type="radio"
          name={name}
          value="private"
          checked={value === "private"}
          disabled={disabled}
          onChange={() => onChange("private")}
        />
        Private
      </label>
    </fieldset>
  );
}

export interface ChangeVisibilityDialogProps {
  owner: string;
  name: string;
  value: RepositoryVisibility;
  onValueChange(value: RepositoryVisibility): void;
  /** Closes the confirmation without changing anything. */
  onCancel(): void;
  /** Reports the repository the server stored after a successful change. */
  onChanged(repository: RepositoryRecord): void;
}

/**
 * Confirmation flow of the visibility change. The administrator selects the
 * wanted value and confirms; the typed confirmation is optional, so the change
 * never requires retyping the repository name, while a mistyped value is
 * refused by the server and leaves the stored visibility untouched.
 */
export function ChangeVisibilityDialog({
  owner,
  name,
  value,
  onValueChange,
  onCancel,
  onChanged,
}: ChangeVisibilityDialogProps) {
  const confirmationId = useId();
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const typed = confirmation.trim();
      const repository = await changeRepositoryVisibility(owner, name, {
        visibility: value,
        ...(typed.length > 0 ? { confirmation: typed } : {}),
      });
      onChanged(repository);
    } catch (failure) {
      const fieldErrors = fieldErrorsOf(failure);
      setError(
        Object.values(fieldErrors)[0] ??
          messageOf(failure, "Unable to change the visibility right now."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Change repository visibility"
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      actions={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void submit()} disabled={busy}>
            Confirm visibility
          </Button>
        </>
      }
    >
      <p>The change takes effect immediately and affects who can read this repository.</p>
      <RepositoryVisibilityChoices
        legend="Repository visibility"
        name="change-visibility"
        value={value}
        onChange={onValueChange}
        disabled={busy}
      />
      <FormField
        id={confirmationId}
        label="Repository name"
        description="Optional. A typed name that does not match this repository blocks the change."
        error={error ?? undefined}
      >
        <input
          id={confirmationId}
          type="text"
          value={confirmation}
          autoComplete="off"
          disabled={busy}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </FormField>
    </Dialog>
  );
}

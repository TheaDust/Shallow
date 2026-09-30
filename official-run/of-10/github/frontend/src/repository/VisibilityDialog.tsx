import { useEffect, useState, type FormEvent } from "react";

import { apiErrorMessage, readErrorFields } from "../lib/api";
import {
  changeRepositoryVisibility,
  type RepositoryOverview,
  type RepositoryVisibility,
} from "../lib/repositories-api";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import { VisibilityChoice } from "./VisibilityChoice";

export interface VisibilityDialogProps {
  open: boolean;
  owner: string;
  name: string;
  onOpenChange(open: boolean): void;
  onChanged(repository: RepositoryOverview): void;
}

/**
 * Confirmation flow of the repository visibility change (REQ-3-4). Confirming
 * does not require the repository name to be retyped; when a name is entered it
 * must match, so a wrong confirmation text leaves the visibility unchanged.
 */
export function VisibilityDialog({
  open,
  owner,
  name,
  onOpenChange,
  onChanged,
}: VisibilityDialogProps) {
  const [visibility, setVisibility] = useState<RepositoryVisibility>("public");
  const [confirmation, setConfirmation] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVisibility("public");
    setConfirmation("");
    setFieldError(null);
    setError(null);
  }, [open]);

  // The dialog element exists only while it is open, so its hidden controls
  // never shadow the page's own controls.

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setFieldError(null);
    setError(null);
    try {
      const repository = await changeRepositoryVisibility(owner, name, {
        visibility,
        confirmationName: confirmation.trim(),
      });
      onChanged(repository);
      onOpenChange(false);
    } catch (caught) {
      const fields = readErrorFields(caught);
      setFieldError(fields.confirmationName ?? null);
      if (fields.visibility) setError(fields.visibility);
      else if (!fields.confirmationName) {
        setError(apiErrorMessage(caught, "The visibility could not be changed."));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <Dialog
      open
      title="Change repository visibility"
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <form
        className="repository-form"
        aria-label="Change repository visibility"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void confirm();
        }}
      >
        <p>Changing the repository visibility changes who can read it.</p>
        <VisibilityChoice
          groupName="visibility-change"
          legend="Repository visibility"
          value={visibility}
          onChange={setVisibility}
        />
        <FormField
          id="visibility-confirmation"
          label="Repository name"
          description="Type the repository name to confirm the change. This is optional."
          error={fieldError ?? undefined}
        >
          <input
            id="visibility-confirmation"
            type="text"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </FormField>
        {error ? (
          <p role="alert" className="form-message form-message--error">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={busy}>
          Confirm visibility
        </Button>
      </form>
    </Dialog>
  );
}

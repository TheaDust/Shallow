import { useEffect, useState } from "react";

import { errorMessageOf, fieldErrorsOf } from "../auth/api";
import { Button, Combobox, Dialog } from "../ui";
import { changeDefaultBranch } from "./api";
import type { RepositoryOwnerKind, RepositoryView } from "./types";

export interface RepositoryBranchesSettingsProps {
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
  /** The stored repository; only an administrator reaches this panel. */
  repository: RepositoryView;
  /** Reports the repository returned by a saved default-branch change. */
  onUpdated(repository: RepositoryView): void;
}

const CHANGE_ERROR = "We could not change the default branch. Try again.";

/**
 * "Branches" panel of the repository Settings: the administrator picks the
 * repository default branch in the native "Default branch" select and activates
 * "Update", which opens the confirmation flow whose "Confirm" button saves the
 * choice. The default branch is the one read when the repository is opened
 * without an explicit branch; changing it deletes and rewrites nothing, so the
 * previous branch and its commits stay available in the selector.
 */
export function RepositoryBranchesSettings({
  ownerKind,
  owner,
  name,
  repository,
  onUpdated,
}: RepositoryBranchesSettingsProps) {
  const [draft, setDraft] = useState(repository.defaultBranch);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setDraft(repository.defaultBranch);
  }, [repository.defaultBranch]);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await changeDefaultBranch(ownerKind, owner, name, draft);
      onUpdated(next);
      setConfirming(false);
      setStatus("Default branch updated.");
    } catch (failure) {
      const errors = fieldErrorsOf(failure);
      setError(errors?.branch ?? errorMessageOf(failure) ?? CHANGE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="repository-settings__section" aria-label="Branches">
      <p className="repository-settings__description">
        The default branch is the one shown when this repository is opened without an explicit
        branch.
      </p>
      <Combobox
        label="Default branch"
        value={draft}
        options={repository.branches.map((branch) => ({ value: branch, label: branch }))}
        onChange={(event) => {
          setDraft(event.target.value);
          setStatus(null);
          setError(null);
        }}
      />
      {status ? <p role="status">{status}</p> : null}
      <div className="app-form__actions">
        <Button
          variant="secondary"
          onClick={() => {
            setError(null);
            setStatus(null);
            setConfirming(true);
          }}
        >
          Update
        </Button>
      </div>
      {confirming ? (
        <ConfirmDefaultBranchDialog
          draft={draft}
          name={name}
          busy={busy}
          error={error}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            void confirm();
          }}
        />
      ) : null}
    </section>
  );
}

interface ConfirmDefaultBranchDialogProps {
  draft: string;
  name: string;
  busy: boolean;
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
}

/**
 * Confirmation step of the default-branch change. It is only mounted while it
 * is open, so a closed confirmation never adds a second control named after the
 * "Default branch" setting to the page.
 */
function ConfirmDefaultBranchDialog({
  draft,
  name,
  busy,
  error,
  onCancel,
  onConfirm,
}: ConfirmDefaultBranchDialogProps) {
  return (
    <Dialog
      open
      title="Update default branch"
      description={`Set ${draft} as the default branch of ${name}. The current branch, its commits and its files stay unchanged.`}
      showClose={false}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      actions={
        <>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} aria-busy={busy} onClick={onConfirm}>
            Confirm
          </Button>
        </>
      }
    >
      {error ? (
        <p className="app-form__error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

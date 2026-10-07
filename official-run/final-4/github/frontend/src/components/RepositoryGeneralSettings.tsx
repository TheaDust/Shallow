import { useState } from "react";

import { ApiError } from "../lib/api";
import { navigate } from "../lib/hash-route";
import {
  saveRepositoryArchived,
  saveRepositoryVisibility,
  type RepositorySummary,
} from "../lib/org-api";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

type StatusAction = "archive" | "restore";

const STATUS_COPY: Record<
  StatusAction,
  { title: string; description: string; confirm: string; failure: string }
> = {
  archive: {
    title: "Archive repository",
    description:
      "Archiving makes this repository read-only for everyone; its files, issues and pull requests stay readable.",
    confirm: "Confirm archive",
    failure: "Unable to archive this repository. Please try again.",
  },
  restore: {
    title: "Restore repository",
    description:
      "Restoring returns this repository to Active; its files, issues, branches and permissions stay unchanged.",
    confirm: "Confirm restore",
    failure: "Unable to restore this repository. Please try again.",
  },
};

/**
 * "General" section of the repository settings. Visibility is changed through
 * the confirmation flow ("Change visibility" → radio → "Confirm visibility")
 * and is only offered to a repository administrator; the server re-checks the
 * same permission, so a non-administrator never sees an actionable control and
 * could not use one anyway.
 *
 * The archive status (REQ-3-5) follows the same shape: the administrator opens
 * "Archive repository" (or "Restore repository" while archived) and confirms it
 * in a dialog named after that action, and the stored status decides what the
 * overview marker and every write control read.
 */
export function RepositoryGeneralSettings({ repository }: { repository: RepositorySummary }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<"public" | "private">(repository.visibility);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const visibilityLabel = repository.visibility === "public" ? "Public" : "Private";
  const statusLabel = repository.archived ? "Archived" : "Active";

  const openDialog = () => {
    setChoice(repository.visibility);
    setError(null);
    setOpen(true);
  };

  const confirm = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveRepositoryVisibility(repository.owner.id, repository.name, choice);
      if (!result.ok) {
        setError(result.fieldErrors.visibility ?? result.message);
        setSaving(false);
        return;
      }
      setOpen(false);
      setSaving(false);
      // The repository overview is the view that shows the new marker.
      navigate(
        `/repositories/${encodeURIComponent(result.value.owner.id)}/${encodeURIComponent(result.value.name)}`,
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Unable to change the repository visibility. Please try again.",
      );
      setSaving(false);
    }
  };

  const closeStatusDialog = () => {
    setStatusAction(null);
    setStatusError(null);
  };

  const confirmStatus = async () => {
    if (!statusAction || statusSaving) return;
    const copy = STATUS_COPY[statusAction];
    setStatusSaving(true);
    setStatusError(null);
    try {
      const archived = statusAction === "archive";
      const result = await saveRepositoryArchived(repository.owner.id, repository.name, archived);
      if (!result.ok) {
        setStatusError(result.fieldErrors.archived ?? result.message);
        setStatusSaving(false);
        return;
      }
      setStatusAction(null);
      setStatusSaving(false);
      // The overview is the view that displays the "Archived" marker.
      navigate(
        `/repositories/${encodeURIComponent(result.value.owner.id)}/${encodeURIComponent(result.value.name)}`,
      );
    } catch {
      setStatusError(copy.failure);
      setStatusSaving(false);
    }
  };

  return (
    <div className="repository-general" role="region" aria-label="General">
      <dl className="repository-general__facts">
        <dt>Visibility</dt>
        <dd>{visibilityLabel}</dd>
        <dt>Status</dt>
        <dd>{statusLabel}</dd>
      </dl>
      {repository.canManage ? (
        <Button variant="secondary" onClick={openDialog}>
          Change visibility
        </Button>
      ) : (
        <p className="repository-general__hint">
          You need administrator permission on this repository to change its visibility.
        </p>
      )}

      {repository.canManage ? (
        <Button variant="secondary" onClick={() => setStatusAction(repository.archived ? "restore" : "archive")}>
          {repository.archived ? "Restore repository" : "Archive repository"}
        </Button>
      ) : null}

      {open ? (
        <Dialog
          open
          title="Change visibility"
          description="Changing the visibility changes who can find and read this repository."
          onOpenChange={(next) => {
            if (!next) {
              setOpen(false);
              setError(null);
            }
          }}
          actions={
            <Button variant="primary" disabled={saving} onClick={confirm}>
              {saving ? "Saving…" : "Confirm visibility"}
            </Button>
          }
        >
          <div className="repository-general__choices">
            <label className="repository-general__choice">
              <input
                type="radio"
                name="visibility"
                value="public"
                checked={choice === "public"}
                onChange={() => setChoice("public")}
              />
              Public
            </label>
            <label className="repository-general__choice">
              <input
                type="radio"
                name="visibility"
                value="private"
                checked={choice === "private"}
                onChange={() => setChoice("private")}
              />
              Private
            </label>
          </div>
          {error ? (
            <p className="repository-general__error" role="alert">
              {error}
            </p>
          ) : null}
        </Dialog>
      ) : null}

      {statusAction ? (
        <Dialog
          open
          title={STATUS_COPY[statusAction].title}
          description={STATUS_COPY[statusAction].description}
          onOpenChange={(next) => {
            if (!next) closeStatusDialog();
          }}
          actions={
            <Button variant="primary" disabled={statusSaving} onClick={confirmStatus}>
              {statusSaving ? "Saving…" : STATUS_COPY[statusAction].confirm}
            </Button>
          }
        >
          <p className="repository-general__status-note">
            {statusAction === "archive"
              ? "Write controls such as file editing, issue creation and pull-request creation become unavailable."
              : "The repository returns to Active with its existing content unchanged."}
          </p>
          {statusError ? (
            <p className="repository-general__error" role="alert">
              {statusError}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}

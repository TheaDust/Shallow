import { useState } from "react";

import { ApiError } from "../lib/api";
import { navigate } from "../lib/hash-route";
import {
  saveRepositoryArchive,
  saveRepositoryVisibility,
  type RepositorySummary,
} from "../lib/org-api";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

/**
 * "General" section of the repository settings. Visibility is changed through
 * the confirmation flow ("Change visibility" → radio → "Confirm visibility")
 * and is only offered to a repository administrator; the server re-checks the
 * same permission, so a non-administrator never sees an actionable control and
 * could not use one anyway.
 *
 * The same administrator reaches the archive/restore flow here (REQ-3-5): the
 * button is named "Archive repository" for an Active repository and "Restore
 * repository" for an Archived one, and the confirmation dialog carries that same
 * accessible name with a "Confirm archive" or "Confirm restore" button.
 */
export function RepositoryGeneralSettings({ repository }: { repository: RepositorySummary }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<"public" | "private">(repository.visibility);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const visibilityLabel = repository.visibility === "public" ? "Public" : "Private";
  // The archived repository offers the inverse operation under its own name.
  const archiveLabel = repository.archived ? "Restore repository" : "Archive repository";
  const archiveConfirmLabel = repository.archived ? "Confirm restore" : "Confirm archive";

  const openArchiveDialog = () => {
    setArchiveError(null);
    setArchiveOpen(true);
  };

  const confirmArchive = async () => {
    if (archiving) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      const result = await saveRepositoryArchive(
        repository.owner.id,
        repository.name,
        !repository.archived,
      );
      if (!result.ok) {
        setArchiveError(result.fieldErrors.archived ?? result.message);
        setArchiving(false);
        return;
      }
      setArchiveOpen(false);
      setArchiving(false);
      // The overview is the view that shows the Archived marker.
      navigate(
        `/repositories/${encodeURIComponent(result.value.owner.id)}/${encodeURIComponent(result.value.name)}`,
      );
    } catch (caught) {
      setArchiveError(
        caught instanceof ApiError
          ? caught.message
          : "Unable to change the repository status. Please try again.",
      );
      setArchiving(false);
    }
  };

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

  return (
    <div className="repository-general" role="region" aria-label="General">
      <dl className="repository-general__facts">
        <dt>Visibility</dt>
        <dd>{visibilityLabel}</dd>
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
        <div className="repository-general__archive">
          <Button variant="secondary" onClick={openArchiveDialog}>
            {archiveLabel}
          </Button>
        </div>
      ) : null}

      {archiveOpen ? (
        <Dialog
          open
          title={archiveLabel}
          description={
            repository.archived
              ? "Restoring returns the repository to Active. Its files, issues, branches and permissions stay unchanged."
              : "Archiving keeps the repository readable while file editing, issue creation and pull-request creation become unavailable."
          }
          onOpenChange={(next) => {
            if (!next) {
              setArchiveOpen(false);
              setArchiveError(null);
            }
          }}
          actions={
            <Button variant="primary" disabled={archiving} onClick={confirmArchive}>
              {archiving ? "Saving…" : archiveConfirmLabel}
            </Button>
          }
        >
          {archiveError ? (
            <p className="repository-general__error" role="alert">
              {archiveError}
            </p>
          ) : null}
        </Dialog>
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
    </div>
  );
}

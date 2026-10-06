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
 * REQ-3-5 adds the archive flow: the same administrator archives or restores the
 * repository behind a confirmation dialog whose accessible name and confirm
 * button match the action. Both flows only navigate to the overview once the
 * server confirmed the new stored status.
 */
export function RepositoryGeneralSettings({ repository }: { repository: RepositorySummary }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<"public" | "private">(repository.visibility);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveSaving, setArchiveSaving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const visibilityLabel = repository.visibility === "public" ? "Public" : "Private";
  const archived = repository.archived === true;
  const archiveName = archived ? "Restore repository" : "Archive repository";
  const confirmArchiveName = archived ? "Confirm restore" : "Confirm archive";

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

  const confirmArchive = async () => {
    if (archiveSaving) return;
    setArchiveSaving(true);
    setArchiveError(null);
    try {
      const result = await saveRepositoryArchive(repository.owner.id, repository.name, !archived);
      if (!result.ok) {
        setArchiveError(result.fieldErrors.archived ?? result.message);
        setArchiveSaving(false);
        return;
      }
      setArchiveOpen(false);
      setArchiveSaving(false);
      // The overview is the view that shows the Archived marker and the write
      // controls, so it re-reads the stored status after the change.
      navigate(
        `/repositories/${encodeURIComponent(result.value.owner.id)}/${encodeURIComponent(result.value.name)}`,
      );
    } catch (caught) {
      setArchiveError(
        caught instanceof ApiError
          ? caught.message
          : `Unable to ${archived ? "restore" : "archive"} the repository. Please try again.`,
      );
      setArchiveSaving(false);
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
          <p className="repository-general__status">
            {archived
              ? "This repository is archived and is read-only for everyone."
              : "Archiving makes the repository read-only for everyone."}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setArchiveError(null);
              setArchiveOpen(true);
            }}
          >
            {archiveName}
          </Button>
        </div>
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

      {archiveOpen ? (
        <Dialog
          open
          title={archiveName}
          description={
            archived
              ? "Restoring returns the repository to Active. Its files, issues, branches and permissions are unchanged."
              : "Archiving makes the repository read-only for everyone until it is restored. Its files, issues, branches and permissions are kept."
          }
          onOpenChange={(next) => {
            if (!next) {
              setArchiveOpen(false);
              setArchiveError(null);
            }
          }}
          actions={
            <Button variant="primary" disabled={archiveSaving} onClick={confirmArchive}>
              {archiveSaving ? "Saving…" : confirmArchiveName}
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
    </div>
  );
}

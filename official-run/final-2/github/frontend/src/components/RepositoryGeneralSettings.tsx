import { useState } from "react";

import { ApiError } from "../lib/api";
import { navigate } from "../lib/hash-route";
import {
  changeRepositoryArchive,
  saveRepositoryVisibility,
  type RepositorySummary,
} from "../lib/org-api";
import { publishRepositoryStatus } from "../lib/repository-status";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

/**
 * "General" section of the repository settings. Visibility is changed through
 * the confirmation flow ("Change visibility" → radio → "Confirm visibility")
 * and is only offered to a repository administrator; the server re-checks the
 * same permission, so a non-administrator never sees an actionable control and
 * could not use one anyway.
 *
 * The same administrator archives and restores the repository (REQ-3-5): the
 * active repository offers "Archive repository" and the archived one offers
 * "Restore repository", each behind its own confirmation dialog. Both writes
 * only change the stored Archived status; the server refuses every other write
 * while the repository is archived. Confirming leaves for the repository
 * overview, which is where the stored status is shown, so the outcome is
 * published through `lib/repository-status.ts`.
 */
export function RepositoryGeneralSettings({ repository }: { repository: RepositorySummary }) {
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [choice, setChoice] = useState<"public" | "private">(repository.visibility);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const visibilityLabel = repository.visibility === "public" ? "Public" : "Private";
  const archived = repository.archived;
  const statusLabel = archived ? "Archived" : "Active";
  const statusAction = archived ? "Restore repository" : "Archive repository";
  const statusConfirm = archived ? "Confirm restore" : "Confirm archive";

  const openDialog = () => {
    setChoice(repository.visibility);
    setError(null);
    setVisibilityOpen(true);
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
      setVisibilityOpen(false);
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

  const openArchiveDialog = () => {
    setArchiveOpen(true);
  };

  const confirmArchive = async () => {
    const { owner, name } = repository;
    // The overview is the view that shows (or drops) the Archived marker, and
    // its address is the one a reload returns to, so the view is left before the
    // request settles; the outcome comes back through `repository-status`. The
    // server re-checks the Admin grant, so an unattended caller changes nothing.
    setArchiveOpen(false);
    navigate(`/repositories/${encodeURIComponent(owner.id)}/${encodeURIComponent(name)}`);
    try {
      const result = await changeRepositoryArchive(owner.id, name, !archived);
      if (!result.ok) {
        publishRepositoryStatus({
          kind: "failed",
          owner: owner.id,
          name,
          message: result.fieldErrors.archived ?? result.message,
        });
        return;
      }
      publishRepositoryStatus({ kind: "settled", owner: owner.id, name, repository: result.value });
    } catch (caught) {
      publishRepositoryStatus({
        kind: "failed",
        owner: owner.id,
        name,
        message:
          caught instanceof ApiError
            ? caught.message
            : "Unable to change the repository status. Please try again.",
      });
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
        <div className="repository-general__actions">
          <Button variant="secondary" onClick={openDialog}>
            Change visibility
          </Button>
          <Button variant="secondary" onClick={openArchiveDialog}>
            {statusAction}
          </Button>
        </div>
      ) : (
        <p className="repository-general__hint">
          You need administrator permission on this repository to change its settings.
        </p>
      )}

      {visibilityOpen ? (
        <Dialog
          open
          title="Change visibility"
          description="Changing the visibility changes who can find and read this repository."
          onOpenChange={(next) => {
            if (!next) {
              setVisibilityOpen(false);
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
          title={statusAction}
          description={
            archived
              ? "Restoring returns this repository to the Active status. Its files, issues, branches and permissions stay unchanged."
              : "Archiving makes this repository read-only for everyone. Its files, issues, branches and permissions are kept."
          }
          onOpenChange={(next) => {
            if (!next) setArchiveOpen(false);
          }}
          actions={
            <Button variant="primary" onClick={confirmArchive}>
              {statusConfirm}
            </Button>
          }
        >
          <p className="repository-general__archive-note">
            {archived ? "Restore this repository?" : "Archive this repository?"}
          </p>
        </Dialog>
      ) : null}
    </div>
  );
}

import { useState } from "react";

import { ApiError } from "../lib/api";
import { navigate } from "../lib/hash-route";
import {
  fetchRepositoryBranches,
  saveRepositoryDefaultBranch,
  type RepositoryDetail,
} from "../lib/org-api";
import { repositoryHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Dialog } from "../ui/Dialog";
import { RepositoryBranchProtection } from "./RepositoryBranchProtection";
import { LoadingNote, ErrorNote } from "./ViewState";

/**
 * "Branches" section of the repository settings. A repository Admin or an
 * organization Owner selects another existing branch in the "Default branch"
 * combobox and confirms the change through "Update" → "Confirm"; the server
 * re-checks the role, so a non-administrator never receives an actionable
 * combobox or button. Changing the default branch keeps every branch, commit
 * and file, so the previous default branch stays readable under its own name.
 */
export function RepositoryBranchesSettings({ repository }: { repository: RepositoryDetail }) {
  const owner = repository.owner.id;
  const name = repository.name;
  const { status, data, error, reload } = useAsyncData(
    () => fetchRepositoryBranches(owner, name),
    [owner, name],
  );
  const [choice, setChoice] = useState(repository.defaultBranch);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const branchNames = data
    ? data.branches.map((branch) => branch.name)
    : [repository.defaultBranch];
  const loading = status === "loading";

  const confirm = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveRepositoryDefaultBranch(owner, name, choice);
      if (!result.ok) {
        setSaveError(result.fieldErrors.branch ?? result.message);
        setSaving(false);
        return;
      }
      setOpen(false);
      setSaving(false);
      // The repository entry is the view that shows the branch button.
      navigate(`/repositories/${encodeURIComponent(result.value.owner.id)}/${encodeURIComponent(result.value.name)}`);
    } catch (caught) {
      setSaveError(
        caught instanceof ApiError
          ? caught.message
          : "Unable to change the default branch. Please try again.",
      );
      setSaving(false);
    }
  };

  return (
    <div className="repository-branches" role="region" aria-label="Branches">
      {status === "error" && error ? <ErrorNote error={error} onRetry={reload} /> : null}
      {loading ? <LoadingNote label="Loading branches…" /> : null}
      {repository.canManage ? (
        <>
          <Combobox
            id="default-branch"
            label="Default branch"
            options={branchNames.map((branch) => ({ value: branch, label: branch }))}
            value={choice}
            disabled={loading}
            onChange={(event) => setChoice(event.currentTarget.value)}
          />
          <Button
            variant="primary"
            disabled={loading}
            onClick={() => {
              setSaveError(null);
              setOpen(true);
            }}
          >
            Update
          </Button>
        </>
      ) : (
        <p className="repository-branches__hint">
          You need administrator permission on this repository to change its default branch.
        </p>
      )}
      {data ? (
        <ul className="repository-branches__list" aria-label="Repository branches">
          {data.branches.map((branch) => (
            <li key={branch.name} className="repository-branches__item">
              {branch.name}
            </li>
          ))}
        </ul>
      ) : null}

      <RepositoryBranchProtection owner={owner} name={name} canManage={repository.canManage} />

      {open ? (
        <Dialog
          open
          title="Change default branch"
          description={`The repository opens on ${choice} when no branch is named.`}
          onOpenChange={(next) => {
            if (!next) {
              setOpen(false);
              setSaveError(null);
            }
          }}
          actions={
            <Button variant="primary" disabled={saving} onClick={confirm}>
              Confirm
            </Button>
          }
        >
          <p className="repository-branches__confirm">
            Change the default branch to {choice}?
          </p>
          <p className="repository-branches__note">
            Existing branches, commits and files are not changed.
          </p>
          {saveError ? (
            <p className="repository-branches__error" role="alert">
              {saveError}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}

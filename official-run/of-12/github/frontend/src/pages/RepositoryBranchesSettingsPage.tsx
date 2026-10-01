import { useEffect, useState } from "react";

import { Button, Dialog } from "../ui";
import { BranchProtectionSettings } from "../features/repositories/BranchProtectionSettings";
import { RepositoryLoadState } from "../features/repositories/RepositoryFallbacks";
import { RepositoryNav } from "../features/repositories/RepositoryNav";
import { changeRepositoryDefaultBranch } from "../features/repositories/repository-api";
import { useRepositoryOverview } from "../features/repositories/use-repository";

export interface RepositoryBranchesSettingsPageProps {
  owner: string;
  name: string;
}

const DEFAULT_BRANCH_ID = "repository-default-branch";

/**
 * Branch settings of a repository (REQ-4-3-3).
 *
 * The administrator picks an existing branch from the native "Default branch"
 * dropdown, activates "Update" and confirms the change in the confirmation
 * dialog. The change only stores which branch a page reads when its address
 * names none: the previous default branch, its commits and every other branch
 * stay exactly as they were.
 *
 * Only a repository Admin (or an organization Owner) sees the dropdown and the
 * update button; every other viewer — including a visitor of a public
 * repository — gets a read-only note instead, and the server refuses the write
 * as well.
 *
 * The page also carries the branch protection rules of the repository
 * (REQ-6-1): the stored rules are listed for every viewer, while the entry that
 * creates or changes one appears only for a repository Admin.
 */
export function RepositoryBranchesSettingsPage({ owner, name }: RepositoryBranchesSettingsPageProps) {
  const { state, repository, reload } = useRepositoryOverview(owner, name);
  const [selected, setSelected] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const defaultBranch = repository?.defaultBranch ?? "main";

  useEffect(() => {
    if (repository) setSelected(repository.defaultBranch ?? "main");
  }, [repository]);

  if (!repository || state !== "ready") return <RepositoryLoadState state={state} />;

  const branchNames = repository.branches.map((branch) => branch.name);

  const confirm = async () => {
    setSaving(true);
    setError(null);
    const result = await changeRepositoryDefaultBranch(repository.owner, repository.name, { branch: selected });
    setSaving(false);
    if (!result.ok) {
      setError(result.errors.branch ?? result.message);
      return;
    }
    setOpen(false);
    setMessage(`The default branch is now ${result.data.defaultBranch ?? selected}.`);
    reload();
  };

  return (
    <main className="repository-branches-settings-page">
      <h1>Branches</h1>
      <p className="repository-branches-settings-page__repository">
        <a href={`#/${repository.owner}/${repository.name}`}>{repository.fullName}</a>
      </p>
      <RepositoryNav owner={repository.owner} name={repository.name} active="settings" />
      {message ? <p role="status">{message}</p> : null}

      {repository.canChangeDefaultBranch ? (
        <section className="repository-branches-settings" aria-label="Default branch">
          <label className="repository-branches-settings__label" htmlFor={DEFAULT_BRANCH_ID}>
            Default branch
          </label>
          <select
            id={DEFAULT_BRANCH_ID}
            name="defaultBranch"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {branchNames.map((branchName) => (
              <option key={branchName} value={branchName}>
                {branchName}
              </option>
            ))}
          </select>
          <Button onClick={() => setOpen(true)}>Update</Button>
        </section>
      ) : (
        <p className="repository-branches-settings__restricted">
          {`The default branch is ${defaultBranch}. Only a repository Admin can change the default branch.`}
        </p>
      )}

      <BranchProtectionSettings repository={repository} onSaved={reload} />

      {open ? (
        <Dialog
          open={open}
          title="Change default branch"
          onOpenChange={setOpen}
          actions={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={saving} onClick={confirm}>
                Confirm
              </Button>
            </>
          }
        >
          <p className="repository-branches-settings__confirmation">
            {`Change the default branch from ${defaultBranch} to ${selected}?`}
          </p>
          {error ? (
            <p className="repository-branches-settings__error" role="alert">
              {error}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </main>
  );
}

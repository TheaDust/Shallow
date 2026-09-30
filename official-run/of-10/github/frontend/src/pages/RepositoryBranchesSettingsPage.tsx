import { useEffect, useState, type FormEvent } from "react";

import { AccessDeniedPage } from "./AccessDeniedPage";
import { NotFoundPage, repositoryAccessHint } from "./NotFoundPage";
import { apiErrorMessage, readErrorFields } from "../lib/api";
import { updateRepositoryDefaultBranch } from "../lib/repository-edits-api";
import { repositoryTitle, type RepositoryBranch } from "../lib/repositories-api";
import { RepositoryChrome } from "../repository/RepositoryChrome";
import { BranchProtectionPanel } from "../repository/BranchProtectionPanel";
import { RepositorySettingsNav } from "../repository/RepositorySettingsNav";
import { useRepositoryOverview } from "../repository/useRepositoryOverview";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

export interface RepositoryBranchesSettingsPageProps {
  owner: string;
  name: string;
}

/**
 * Repository settings → Branches (REQ-4-3-3). A repository administrator picks
 * an existing branch from the native `Default branch` select, activates
 * `Update` and confirms the change in the confirmation dialog; the stored
 * default is then read by the repository entry that names no branch, and every
 * branch keeps its head and history. A non-Administrator gets no selector and no
 * update entry at all, and the server refuses the change as well.
 */
export function RepositoryBranchesSettingsPage({
  owner,
  name,
}: RepositoryBranchesSettingsPageProps) {
  const { state, reload } = useRepositoryOverview(owner, name);
  const [selected, setSelected] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const defaultBranch = state.status === "ready" ? state.repository.defaultBranch : "";
  useEffect(() => {
    if (defaultBranch) setSelected(defaultBranch);
  }, [defaultBranch]);

  if (state.status === "loading") {
    return (
      <main aria-busy="true">
        <p role="status">Loading settings…</p>
      </main>
    );
  }

  if (state.status === "denied") return <AccessDeniedPage owner={owner} name={name} />;
  if (state.status === "missing") return <NotFoundPage hint={repositoryAccessHint()} />;
  if (state.status === "error") {
    return (
      <main>
        <h1>Settings unavailable</h1>
        <p role="alert">The repository settings could not be loaded. Reload the page to try again.</p>
      </main>
    );
  }

  const repository = state.repository;
  const canAdminister = repository.permissions?.canAdminister === true;
  const branches: RepositoryBranch[] = repository.branches ?? [
    { name: repository.defaultBranch, headCommitId: null },
  ];

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateRepositoryDefaultBranch(owner, name, selected);
      setDialogOpen(false);
      setStatus(`The default branch is now ${selected}.`);
      reload();
    } catch (caught) {
      const fields = readErrorFields(caught);
      setDialogOpen(false);
      setError(fields.branch ?? apiErrorMessage(caught, "The default branch could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <RepositoryChrome
        owner={owner}
        name={name}
        title={repositoryTitle(repository)}
        visibility={repository.visibility}
        description={repository.description}
        activeEntry="Settings"
      />
      <h2>Branches</h2>
      <RepositorySettingsNav owner={owner} name={name} current="branches" />
      {status ? (
        <p role="status" className="form-message">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="form-message form-message--error">
          {error}
        </p>
      ) : null}
      {canAdminister ? (
        <form
          className="repository-form"
          aria-label="Repository branches"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            setDialogOpen(true);
          }}
        >
          <div className="ui-field">
            <label htmlFor="default-branch">Default branch</label>
            <select
              id="default-branch"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              {branches.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}
                </option>
              ))}
            </select>
            <p className="ui-field__description">
              The default branch is read when the repository is opened without a branch.
            </p>
          </div>
          <Button type="submit" variant="primary" disabled={busy}>
            Update
          </Button>
        </form>
      ) : (
        <p className="repository-branch">
          Default branch: <span className="repository-branch__name">{repository.defaultBranch}</span>
        </p>
      )}
      {/* Branch protection rules (REQ-6-1) live on the same settings page. */}
      <BranchProtectionPanel owner={owner} name={name} canAdminister={canAdminister} />
      {dialogOpen ? (
        <Dialog
          open
          title="Update default branch"
          description={`The repository will be opened on ${selected} by default.`}
          onOpenChange={(next) => {
            if (!busy) setDialogOpen(next);
          }}
          actions={
            <>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => {
                  void confirm();
                }}
              >
                Confirm
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setDialogOpen(false);
                }}
              >
                Cancel
              </Button>
            </>
          }
        >
          <p>
            The default branch becomes <span>{selected}</span>. Existing branches, commits and pull
            requests keep their current references.
          </p>
        </Dialog>
      ) : null}
    </main>
  );
}

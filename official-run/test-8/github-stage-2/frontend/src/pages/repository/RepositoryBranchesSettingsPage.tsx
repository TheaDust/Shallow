import { useState } from "react";

import { fieldErrorsOf, messageOf } from "../../api/auth";
import {
  fetchRepository,
  fetchRepositoryBranches,
  setRepositoryDefaultBranch,
} from "../../api/organizations";
import { useAuth } from "../../auth/AuthProvider";
import { RepositorySettingsNav } from "../../components/RepositorySettingsNav";
import { SiteHeader } from "../../components/SiteHeader";
import { makeHash, navigate } from "../../lib/hash-route";
import { repositoryPath } from "../../lib/repository-paths";
import { useAsyncData } from "../../lib/useAsyncData";
import { Button, Dialog } from "../../ui";

/**
 * Repository “Settings → Branches” (REQ-4-3-3).
 *
 * A repository Admin picks another stored branch in the native “Default branch”
 * select, activates “Update” and confirms the change with “Confirm”; the
 * repository then reads that branch when it is opened without one, while every
 * other branch, commit and file stays stored. Read, Triage and other
 * non-administrators receive neither the select nor the update button (and the
 * server refuses the change anyway).
 */
export function RepositoryBranchesSettingsPage({
  slug,
  repositoryName,
}: {
  slug: string;
  repositoryName: string;
}) {
  const { account } = useAuth();
  const { data, error, loading } = useAsyncData(
    () => fetchRepository(slug, repositoryName),
    [slug, repositoryName],
  );
  const branches = useAsyncData(() => fetchRepositoryBranches(slug, repositoryName), [slug, repositoryName]);
  const repository = data?.repository ?? null;
  const isAdmin = repository?.role === "admin";
  const names = (branches.data?.branches ?? []).map((branch) => branch.name);
  const [choice, setChoice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const selected = choice || repository?.defaultBranch || names[0] || "";

  const save = async () => {
    setPending(true);
    setFailure(null);
    try {
      await setRepositoryDefaultBranch(slug, repositoryName, selected);
    } catch (error_) {
      setPending(false);
      const fields = fieldErrorsOf(error_);
      setFailure(fields.branch ?? messageOf(error_, "Default branch update failed"));
      return;
    }
    setPending(false);
    setConfirming(false);
    // The repository entry is where the new default branch is read.
    navigate(repositoryPath(slug, repositoryName));
  };

  return (
    <main>
      <SiteHeader account={account} />
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a className="breadcrumb__link" href={makeHash(`${repositoryPath(slug, repositoryName)}/settings`)}>
          Settings
        </a>
      </nav>
      <h1>Branches</h1>
      {loading ? <p role="status">Loading…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {repository && !error ? (
        <>
          <RepositorySettingsNav
            ownerLogin={slug}
            repositoryName={repository.name}
            isAdmin={isAdmin}
            active="branches"
          />
          {isAdmin ? (
            <section className="settings-section">
              <label htmlFor="default-branch">Default branch</label>
              <select
                id="default-branch"
                name="defaultBranch"
                value={selected}
                onChange={(event) => setChoice(event.target.value)}
              >
                {names.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <Button variant="primary" onClick={() => setConfirming(true)}>
                Update
              </Button>
              {failure ? (
                <p className="form-error" role="alert">
                  {failure}
                </p>
              ) : null}
            </section>
          ) : (
            <p className="settings-note" role="status">
              You do not have permission to change the default branch.
            </p>
          )}
          {isAdmin && confirming ? (
            <Dialog
              open
              title="Change default branch"
              onOpenChange={(next) => {
                if (!next) setConfirming(false);
              }}
              actions={
                <>
                  <Button onClick={() => setConfirming(false)}>Cancel</Button>
                  <Button variant="primary" disabled={pending} onClick={() => void save()}>
                    Confirm
                  </Button>
                </>
              }
            >
              <p>{`The default branch of this repository will become ${selected}.`}</p>
            </Dialog>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

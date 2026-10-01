import { useState } from "react";

import { ApiError } from "../../lib/api";
import {
  fetchRepositoryBranchSettings,
  updateRepositoryDefaultBranch,
  type RepositoryBranchProtectionRule,
  type RepositoryBranchSettings,
} from "../../lib/repository-code-api";
import type { RepositoryRecord } from "../../lib/repositories-api";
import { useDocumentTitle } from "../../lib/document-title";
import { Button } from "../../ui/Button";
import { Combobox } from "../../ui/Combobox";
import { Dialog } from "../../ui/Dialog";
import { useAccountSession } from "../account/AccountSession";
import { BranchProtectionRules } from "./BranchProtectionRules";
import { RepositoryHeader } from "./RepositoryHeader";
import {
  RepositoryAccessDenied,
  RepositoryLoading,
  RepositoryNotFound,
} from "./RepositoryPageStates";
import { RepositorySettingsNav } from "./RepositorySettingsNav";
import { useRepositoryResource } from "./useRepositoryResource";

export interface RepositoryBranchesSettingsPageProps {
  owner: string;
  name: string;
}

/**
 * The `Branches` panel of the repository settings. Only a repository Admin (or
 * organization Owner) is offered the `Default branch` dropdown and the
 * `Update` button; every other reader gets a read-only page and the server
 * rejects the write anyway. Changing the default branch only changes which
 * branch a repository entry opens first - no branch, commit or file changes.
 */
export function RepositoryBranchesSettingsPage({
  owner,
  name,
}: RepositoryBranchesSettingsPageProps) {
  const { status: sessionStatus, account } = useAccountSession();
  const settings = useRepositoryResource<RepositoryBranchSettings>(
    `repository-branch-settings:${owner}/${name}`,
    sessionStatus !== "loading",
    () => fetchRepositoryBranchSettings(owner, name),
  );

  useDocumentTitle(`${owner}/${name} branches`);

  if (settings.status === "denied") {
    return <RepositoryAccessDenied signedIn={Boolean(account)} />;
  }
  if (settings.status === "missing" || settings.status === "error") {
    return <RepositoryNotFound />;
  }
  if (settings.status !== "ready") {
    return (
      <RepositoryLoading>
        <h1>{`${owner}/${name}`}</h1>
      </RepositoryLoading>
    );
  }

  return <RepositoryBranchesSettingsView initial={settings.value} />;
}

function RepositoryBranchesSettingsView({ initial }: { initial: RepositoryBranchSettings }) {
  const [repository, setRepository] = useState<RepositoryRecord>(initial.repository);
  const [branches] = useState<string[]>(initial.branches);
  const [rules, setRules] = useState<RepositoryBranchProtectionRule[]>(
    initial.branchProtectionRules,
  );
  const [target, setTarget] = useState<string>(
    initial.repository.defaultBranch ?? initial.branches[0] ?? "",
  );
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const owner = repository.owner;
  const name = repository.name;
  const canAdminister = initial.canAdminister === true;

  function confirmChange() {
    updateRepositoryDefaultBranch(owner, name, target)
      .then((result) => {
        setRepository(result.repository);
        setConfirming(false);
        setError(null);
        setStatus(`Default branch updated to ${result.repository.defaultBranch}.`);
      })
      .catch((failure) => {
        setConfirming(false);
        setError(failure instanceof ApiError ? failure.message : "The default branch was not changed.");
      });
  }

  return (
    <div className="repository-settings">
      <RepositoryHeader
        owner={owner}
        name={name}
        visibility={repository.visibility}
        description=""
        defaultBranch={repository.defaultBranch ?? null}
        showVisibilityMarker={false}
        showSettings
        active="settings"
      />
      <div className="repository-settings__body">
        <RepositorySettingsNav owner={owner} name={name} active="branches" />
        <section className="repository-settings__branches">
          <h2>Branches</h2>
          {status ? (
            <p className="repository-settings__status" role="status">
              {status}
            </p>
          ) : null}
          {error ? (
            <p className="repository-settings__error" role="alert">
              {error}
            </p>
          ) : null}
          {canAdminister ? (
            <>
              <p>{`The current default branch is ${repository.defaultBranch ?? "not set"}.`}</p>
              <Combobox
                label="Default branch"
                value={target}
                options={branches.map((branch) => ({ value: branch, label: branch }))}
                onChange={(event) => setTarget(event.target.value)}
              />
              <Button variant="primary" onClick={() => setConfirming(true)}>
                Update
              </Button>
              <Dialog
                open={confirming}
                title="Change default branch"
                onOpenChange={setConfirming}
                actions={
                  <>
                    <Button onClick={() => setConfirming(false)}>Cancel</Button>
                    <Button variant="primary" onClick={confirmChange}>
                      Confirm
                    </Button>
                  </>
                }
              >
                <p>{`Make ${target} the default branch of ${name}?`}</p>
              </Dialog>
            </>
          ) : (
            <>
              <p>{`The default branch is ${repository.defaultBranch ?? "not set"}.`}</p>
              <p>Only a repository administrator can change the default branch.</p>
            </>
          )}
        </section>
        <BranchProtectionRules
          owner={owner}
          name={name}
          canAdminister={canAdminister}
          rules={rules}
          onSaved={setRules}
        />
      </div>
    </div>
  );
}

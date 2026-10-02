import { useId, useState } from "react";

import { useDocumentTitle } from "../../lib/document-title";
import {
  fetchRepository,
  type RepositoryDetail,
  type RepositoryVisibility,
} from "../../lib/organizations-api";
import type { RepositoryRecord } from "../../lib/repositories-api";
import { Button } from "../../ui/Button";
import { useAccountSession } from "../account/AccountSession";
import { ChangeVisibilityDialog, RepositoryVisibilityChoices } from "./ChangeVisibilityDialog";
import { RepositoryHeader } from "./RepositoryHeader";
import { RepositorySettingsNav } from "./RepositorySettingsNav";
import {
  RepositoryAccessDenied,
  RepositoryLoading,
  RepositoryNotFound,
} from "./RepositoryPageStates";
import { useRepositoryResource } from "./useRepositoryResource";

export interface RepositorySettingsPageProps {
  owner: string;
  name: string;
}

/**
 * Repository "Settings": the `General` panel that holds the Danger Zone and
 * the `Manage access` entry. The visibility action is only offered to a
 * repository Admin; every submission is still re-checked on the server, which
 * answers "Access denied" for anybody else.
 */
export function RepositorySettingsPage({ owner, name }: RepositorySettingsPageProps) {
  const { status: sessionStatus, account } = useAccountSession();
  const detail = useRepositoryResource<RepositoryDetail>(
    `repository-settings:${owner}/${name}`,
    sessionStatus !== "loading",
    () => fetchRepository(owner, name),
  );

  useDocumentTitle(`${owner}/${name} settings`);

  if (detail.status === "denied") {
    return <RepositoryAccessDenied signedIn={Boolean(account)} />;
  }
  if (detail.status === "missing" || detail.status === "error") {
    return <RepositoryNotFound />;
  }
  if (detail.status !== "ready") {
    return (
      <RepositoryLoading>
        <h1>{`${owner}/${name}`}</h1>
      </RepositoryLoading>
    );
  }

  return <RepositorySettingsView initial={detail.value} />;
}

function RepositorySettingsView({ initial }: { initial: RepositoryDetail }) {
  const [repository, setRepository] = useState(initial);
  const owner = repository.owner;
  const name = repository.name;

  return (
    <div className="repository-settings">
      <RepositoryHeader
        owner={owner}
        name={name}
        visibility={repository.visibility}
        // The General panel states the stored visibility through its own
        // control, so the settings page does not repeat the overview identity
        // block (visibility marker and description) of the repository page.
        description=""
        defaultBranch={repository.defaultBranch ?? null}
        showVisibilityMarker={false}
        showSettings
        active="settings"
      />
      <div className="repository-settings__body">
        <RepositorySettingsNav owner={owner} name={name} active="general" />
        <RepositoryGeneralPanel
          repository={repository}
          onRepositoryChange={(updated) =>
            setRepository((current) => ({ ...current, ...updated }))
          }
        />
      </div>
    </div>
  );
}

interface RepositoryGeneralPanelProps {
  repository: RepositoryDetail;
  onRepositoryChange(repository: RepositoryRecord): void;
}

function RepositoryGeneralPanel({ repository, onRepositoryChange }: RepositoryGeneralPanelProps) {
  const canAdminister = repository.canAdminister === true;
  // The controls state the stored visibility and carry the value the
  // administrator picks; confirming without a pick re-applies the stored one.
  const [target, setTarget] = useState<RepositoryVisibility>(repository.visibility);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const dangerZoneId = useId();

  return (
    <section className="repository-settings__general">
      <h2>General</h2>
      {status ? (
        <p className="repository-settings__status" role="status">
          {status}
        </p>
      ) : null}
      <section className="repository-danger-zone" aria-labelledby={dangerZoneId}>
        <h3 id={dangerZoneId}>Danger Zone</h3>
        {canAdminister ? (
          <>
            <p>Changing the visibility affects who can read this repository.</p>
            {!confirming ? (
              <>
                <RepositoryVisibilityChoices
                  legend="Repository visibility"
                  name="repository-visibility"
                  value={target}
                  onChange={setTarget}
                />
                <Button
                  variant="danger"
                  onClick={() => {
                    setStatus(null);
                    setConfirming(true);
                  }}
                >
                  Change visibility
                </Button>
              </>
            ) : (
              <ChangeVisibilityDialog
                owner={repository.owner}
                name={repository.name}
                value={target}
                onValueChange={setTarget}
                onCancel={() => {
                  // Nothing was stored, so the controls show the stored value
                  // again instead of a pending one.
                  setTarget(repository.visibility);
                  setConfirming(false);
                }}
                onChanged={(updated) => {
                  setConfirming(false);
                  onRepositoryChange(updated);
                  setStatus("Repository visibility updated.");
                }}
              />
            )}
          </>
        ) : (
          <p>Only a repository administrator can change this setting.</p>
        )}
      </section>
    </section>
  );
}

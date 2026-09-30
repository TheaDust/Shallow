import { useState } from "react";

import { AccessDeniedPage } from "./AccessDeniedPage";
import { NotFoundPage, repositoryAccessHint } from "./NotFoundPage";
import { repositoryTitle } from "../lib/repositories-api";
import { RepositoryChrome } from "../repository/RepositoryChrome";
import { RepositorySettingsNav } from "../repository/RepositorySettingsNav";
import { VisibilityDialog } from "../repository/VisibilityDialog";
import { useRepositoryOverview } from "../repository/useRepositoryOverview";
import { Button } from "../ui/Button";

export interface RepositoryGeneralSettingsPageProps {
  owner: string;
  name: string;
}

/**
 * Repository settings → General (REQ-3-4). The Danger Zone and its "Change
 * visibility" button are rendered only for a repository administrator; the
 * server refuses the change for anybody else even when it is reached directly.
 */
export function RepositoryGeneralSettingsPage({ owner, name }: RepositoryGeneralSettingsPageProps) {
  const { state, reload } = useRepositoryOverview(owner, name);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

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
      <h2>General</h2>
      <RepositorySettingsNav owner={owner} name={name} current="general" />
      {status ? (
        <p role="status" className="form-message">
          {status}
        </p>
      ) : null}
      {canAdminister ? (
        <section className="danger-zone" aria-labelledby="danger-zone-heading">
          <h2 id="danger-zone-heading">Danger Zone</h2>
          <p>Changing the repository visibility changes who can read it.</p>
          <Button variant="danger" onClick={() => setDialogOpen(true)}>
            Change visibility
          </Button>
        </section>
      ) : null}
      <VisibilityDialog
        open={dialogOpen}
        owner={owner}
        name={name}
        onOpenChange={setDialogOpen}
        onChanged={() => {
          setStatus("Visibility updated.");
          reload();
        }}
      />
    </main>
  );
}

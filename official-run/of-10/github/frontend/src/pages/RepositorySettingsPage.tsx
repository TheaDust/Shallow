import { AccessDeniedPage } from "./AccessDeniedPage";
import { NotFoundPage, repositoryAccessHint } from "./NotFoundPage";
import { repositoryTitle } from "../lib/repositories-api";
import { RepositoryChrome } from "../repository/RepositoryChrome";
import { RepositorySettingsNav } from "../repository/RepositorySettingsNav";
import { useRepositoryOverview } from "../repository/useRepositoryOverview";

export interface RepositorySettingsPageProps {
  owner: string;
  name: string;
}

/** Repository Settings landing page; its links open General and Manage access. */
export function RepositorySettingsPage({ owner, name }: RepositorySettingsPageProps) {
  const { state } = useRepositoryOverview(owner, name);

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
      <h2>Repository settings</h2>
      <RepositorySettingsNav owner={owner} name={name} current={null} />
    </main>
  );
}

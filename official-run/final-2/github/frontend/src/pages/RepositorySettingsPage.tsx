import { AppHeader } from "../components/AppHeader";
import { RepositoryGeneralSettings } from "../components/RepositoryGeneralSettings";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { fetchRepository } from "../lib/org-api";
import {
  repositoryAccessHash,
  repositoryBranchesHash,
  repositoryGeneralHash,
  repositoryHash,
} from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/**
 * Repository settings shell. The tab navigation is rendered with the page so
 * "General" and "Manage access" are reachable as soon as Settings opens; the
 * General panel then renders from the loaded repository record.
 */
export function RepositorySettingsPage({ owner, name }: { owner: string; name: string }) {
  const { status, data, error } = useAsyncData(() => fetchRepository(owner, name), [owner, name]);

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body repository-settings">
        <nav className="repository__breadcrumb" aria-label="Breadcrumb">
          <a href={repositoryHash(owner, name)}>
            {data ? `${data.owner.displayName}/${data.name}` : `${owner}/${name}`}
          </a>
        </nav>
        <h1 className="repository-settings__title">Settings</h1>
        <nav className="page-tabs" aria-label="Repository settings">
          <a className="page-tabs__link" href={repositoryGeneralHash(owner, name)} aria-current="page">
            General
          </a>
          <a className="page-tabs__link" href={repositoryBranchesHash(owner, name)}>
            Branches
          </a>
          <a className="page-tabs__link" href={repositoryAccessHash(owner, name)}>
            Manage access
          </a>
        </nav>
        {status === "loading" ? <LoadingNote label="Loading settings…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {status === "ready" && data ? <RepositoryGeneralSettings repository={data} /> : null}
      </section>
    </main>
  );
}

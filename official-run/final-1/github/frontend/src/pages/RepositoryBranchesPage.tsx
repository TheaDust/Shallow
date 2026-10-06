import { AppHeader } from "../components/AppHeader";
import { RepositoryBranchesSettings } from "../components/RepositoryBranchesSettings";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { fetchRepository } from "../lib/org-api";
import { repositoryHash, repositorySettingsHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/**
 * "Branches" page of the repository settings. The breadcrumb keeps the Settings
 * entry so the page is reachable from the repository, and the panel itself
 * decides whether the caller receives the default-branch combobox and the
 * update flow.
 */
export function RepositoryBranchesPage({ owner, name }: { owner: string; name: string }) {
  const { status, data, error } = useAsyncData(() => fetchRepository(owner, name), [owner, name]);

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body repository-branches-page">
        <nav className="repository__breadcrumb" aria-label="Breadcrumb">
          <a href={repositoryHash(owner, name)}>{data ? `${data.owner.displayName}/${data.name}` : name}</a>
          <span aria-hidden="true"> / </span>
          <a href={repositorySettingsHash(owner, name)}>Settings</a>
        </nav>
        <h1 className="repository-settings__title">Branches</h1>
        {status === "loading" ? <LoadingNote label="Loading settings…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {status === "ready" && data ? <RepositoryBranchesSettings repository={data} /> : null}
      </section>
    </main>
  );
}

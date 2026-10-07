import { AppHeader } from "../components/AppHeader";
import { RepositoryAccess } from "../components/RepositoryAccess";
import { fetchRepository } from "../lib/org-api";
import { repositoryHash, repositorySettingsHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/** "Manage access" page: direct grants on one repository. */
export function RepositoryAccessPage({ owner, name }: { owner: string; name: string }) {
  const { data } = useAsyncData(() => fetchRepository(owner, name), [owner, name]);

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body repository-access-page">
        <nav className="repository__breadcrumb" aria-label="Breadcrumb">
          <a href={repositoryHash(owner, name)}>{data ? `${data.owner.displayName}/${data.name}` : name}</a>
          <span aria-hidden="true"> / </span>
          <a href={repositorySettingsHash(owner, name)}>Settings</a>
        </nav>
        <h1 className="repository-access-page__title">Manage access</h1>
        <RepositoryAccess owner={owner} name={name} />
      </section>
    </main>
  );
}

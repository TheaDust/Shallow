import { fetchRepository } from "../../api/organizations";
import { useAuth } from "../../auth/AuthProvider";
import { SiteHeader } from "../../components/SiteHeader";
import { makeHash } from "../../lib/hash-route";
import { useAsyncData } from "../../lib/useAsyncData";

/**
 * Repository “Settings”. A repository Admin reaches it from the repository
 * overview and continues to “Manage access”.
 */
export function RepositorySettingsPage({ slug, repositoryName }: { slug: string; repositoryName: string }) {
  const { account } = useAuth();
  const { data, error, loading } = useAsyncData(() => fetchRepository(slug, repositoryName), [slug, repositoryName]);
  const repository = data?.repository ?? null;
  const organizationName = repository?.organization?.displayName ?? slug;

  return (
    <main>
      <SiteHeader account={account} />
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a className="breadcrumb__link" href={makeHash(`/repositories/${slug}/${repositoryName}`)}>
          {repository ? `${organizationName}/${repository.name}` : repositoryName}
        </a>
      </nav>
      <h1>Settings</h1>
      {loading ? <p role="status">Loading…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {repository && !error && repository.role === "admin" ? (
        <nav className="settings-nav" aria-label="Repository settings">
          <a
            className="settings-nav__link"
            href={makeHash(`/repositories/${slug}/${repositoryName}/settings/access`)}
          >
            Manage access
          </a>
        </nav>
      ) : null}
    </main>
  );
}

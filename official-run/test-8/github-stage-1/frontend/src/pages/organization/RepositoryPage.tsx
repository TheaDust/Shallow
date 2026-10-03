import { fetchRepository } from "../../api/organizations";
import { useAuth } from "../../auth/AuthProvider";
import { SiteHeader } from "../../components/SiteHeader";
import { makeHash } from "../../lib/hash-route";
import { useAsyncData } from "../../lib/useAsyncData";

function formatUpdatedAt(value: string | null): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

/** Repository overview: the heading shows “organization name/repository name”. */
export function RepositoryPage({ slug, repositoryName }: { slug: string; repositoryName: string }) {
  const { account } = useAuth();
  const { data, error, loading } = useAsyncData(() => fetchRepository(slug, repositoryName), [slug, repositoryName]);
  const repository = data?.repository ?? null;
  const organizationName = repository?.organization?.displayName ?? slug;

  return (
    <main>
      <SiteHeader account={account} />
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a className="breadcrumb__link" href={makeHash(`/organizations/${slug}`)}>
          {organizationName}
        </a>
      </nav>
      {loading ? <p role="status">Loading…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {repository && !error ? (
        <>
          <h1 className="repository-heading">
            {organizationName}/<span className="repository-heading__name">{repository.name}</span>
          </h1>
          <p className="repository-description">{repository.description}</p>
          <p className="repository-meta">
            {repository.visibility === "public" ? "Public" : "Private"} · Updated {formatUpdatedAt(repository.updatedAt)}
          </p>
          {repository.role === "admin" ? (
            <nav className="repository-nav" aria-label="Repository">
              <a
                className="repository-nav__link"
                href={makeHash(`/repositories/${slug}/${repositoryName}/settings`)}
              >
                Settings
              </a>
            </nav>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

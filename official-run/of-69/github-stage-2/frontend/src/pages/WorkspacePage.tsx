import { AppHeader } from "../components/AppHeader";
import { fetchMyOrganizations, fetchReadableRepositories } from "../lib/organization-api";
import type { MyOrganization, RepositoryResult } from "../lib/organization-api";
import { organizationUrl, repositoryUrl, type RepositoryOwnerRef } from "../lib/routes";
import type { Account } from "../lib/session-api";
import { useAsyncData } from "../lib/use-async-data";

interface RepositoryGroup {
  owner: string;
  ownerRef: RepositoryOwnerRef;
  repositories: RepositoryResult[];
}

/** The reader's repositories grouped by the owner that provides them. */
function groupByOwner(repositories: RepositoryResult[]): RepositoryGroup[] {
  const groups = new Map<string, RepositoryGroup>();
  for (const repository of repositories) {
    const key = `${repository.owner.type ?? "organization"}:${repository.owner.name}`;
    const group = groups.get(key) ?? {
      owner: repository.owner.displayName,
      ownerRef: { type: repository.owner.type ?? "organization", name: repository.owner.name },
      repositories: [],
    };
    group.repositories.push(repository);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.owner.localeCompare(b.owner));
}

/**
 * Signed-in workspace. It shows the identity that is currently signed in
 * together with the named entries for the organizations this account can see
 * and — including repositories reached through a direct grant rather than a
 * membership — the repositories it can read, grouped by their owner.
 */
export function WorkspacePage({ account }: { account: Account }) {
  const organizations = useAsyncData(fetchMyOrganizations, [account.id]);
  const repositories = useAsyncData(fetchReadableRepositories, [account.id]);
  const repositoryGroups = repositories.data ? groupByOwner(repositories.data) : [];

  return (
    <div className="app-shell">
      <AppHeader username={account.username} />
      <main>
        <h1>{account.username}</h1>
        <p>You are signed in. Your organizations and repositories appear here.</p>
        <p>
          <a href="#/repositories/new">New repository</a>
        </p>
        <section aria-labelledby="workspace-repositories-heading">
          <h2 id="workspace-repositories-heading">Your repositories</h2>
          {repositories.loading ? (
            <p role="status">Loading repositories…</p>
          ) : repositories.error ? (
            <p role="alert">{repositories.error}</p>
          ) : repositoryGroups.length > 0 ? (
            <div className="repository-groups">
              {repositoryGroups.map((group) => (
                <div key={`${group.ownerRef.type}:${group.ownerRef.name}`} className="repository-group">
                  <h3>{group.owner}</h3>
                  <ul className="repository-list">
                    {group.repositories.map((repository) => (
                      <li key={repository.name}>
                        <a href={repositoryUrl(group.ownerRef, repository.name)}>{repository.name}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p>You cannot read any repositories yet.</p>
          )}
        </section>
        <section aria-labelledby="workspace-organizations-heading">
          <h2 id="workspace-organizations-heading">Your organizations</h2>
          {organizations.loading ? (
            <p role="status">Loading organizations…</p>
          ) : organizations.error ? (
            <p role="alert">{organizations.error}</p>
          ) : organizations.data && organizations.data.length > 0 ? (
            <ul className="organization-list">
              {organizations.data.map((organization: MyOrganization) => (
                <li key={organization.name}>
                  <a href={organizationUrl(organization.name)}>{organization.displayName}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p>You do not belong to any organizations yet.</p>
          )}
        </section>
      </main>
    </div>
  );
}

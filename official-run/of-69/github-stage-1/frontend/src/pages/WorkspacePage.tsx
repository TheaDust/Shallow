import { AppHeader } from "../components/AppHeader";
import { fetchMyOrganizations, fetchOrganizationRepositories } from "../lib/organization-api";
import type { MyOrganization, RepositorySummary } from "../lib/organization-api";
import { organizationUrl } from "../lib/routes";
import type { Account } from "../lib/session-api";
import { useAsyncData } from "../lib/use-async-data";

interface WorkspaceOrganization {
  organization: MyOrganization;
  repositories: RepositorySummary[];
}

async function loadWorkspace(): Promise<WorkspaceOrganization[]> {
  const organizations = await fetchMyOrganizations();
  return Promise.all(
    organizations.map(async (organization) => ({
      organization,
      // Only repositories this account can actually read are listed.
      repositories: (await fetchOrganizationRepositories(organization.name)).repositories,
    })),
  );
}

/**
 * Signed-in workspace. It shows the identity that is currently signed in
 * together with the named entries for the organizations this account can see
 * and the repositories it can read.
 */
export function WorkspacePage({ account }: { account: Account }) {
  const workspace = useAsyncData(loadWorkspace, [account.id]);

  return (
    <div className="app-shell">
      <AppHeader username={account.username} />
      <main>
        <h1>{account.username}</h1>
        <p>You are signed in. Your organizations and repositories appear here.</p>
        <section aria-labelledby="workspace-organizations-heading">
          <h2 id="workspace-organizations-heading">Your organizations</h2>
          {workspace.loading ? (
            <p role="status">Loading organizations…</p>
          ) : workspace.error ? (
            <p role="alert">{workspace.error}</p>
          ) : workspace.data && workspace.data.length > 0 ? (
            <ul className="organization-list">
              {workspace.data.map(({ organization, repositories }) => (
                <li key={organization.name}>
                  <a href={organizationUrl(organization.name)}>{organization.displayName}</a>
                  {repositories.length > 0 ? (
                    <ul className="repository-list repository-list--compact">
                      {repositories.map((repository) => (
                        <li key={repository.name}>
                          <a href={organizationUrl(organization.name, "repositories", repository.name)}>
                            {repository.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
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

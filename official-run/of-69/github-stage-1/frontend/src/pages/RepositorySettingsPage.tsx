import { RepositoryLayout } from "../components/RepositoryLayout";
import { fetchRepository } from "../lib/organization-api";
import { useAsyncData } from "../lib/use-async-data";
import { useSession } from "../session/session-context";

/**
 * Repository Settings. It exposes the “Manage access” entry that leads to the
 * repository access list.
 */
export function RepositorySettingsPage({ organization, repository }: { organization: string; repository: string }) {
  const { account } = useSession();
  const detail = useAsyncData(() => fetchRepository(organization, repository), [organization, repository]);
  const loaded = detail.data;

  return (
    <RepositoryLayout
      organizationName={organization}
      repositoryName={repository}
      organizationDisplayName={loaded?.organization.displayName}
      activeSection="settings"
      canManage={loaded?.viewer.canManage ?? false}
      account={account}
      heading="Settings"
    >
      {detail.loading ? <p role="status">Loading settings…</p> : null}
      {detail.error ? (
        <p className="form-error" role="alert">
          {detail.error}
        </p>
      ) : null}
      {loaded ? (
        <p className="page-hint">Review who can read, write or administer this repository.</p>
      ) : null}
    </RepositoryLayout>
  );
}

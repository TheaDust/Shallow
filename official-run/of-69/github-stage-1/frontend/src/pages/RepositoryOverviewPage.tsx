import { RepositoryLayout } from "../components/RepositoryLayout";
import { fetchRepository } from "../lib/organization-api";
import { useAsyncData } from "../lib/use-async-data";
import { useSession } from "../session/session-context";

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

/**
 * Repository overview. The heading names the repository as
 * “organization name/repository name”; a repository the viewer may not read
 * answers “Access denied” instead of exposing any of its content.
 */
export function RepositoryOverviewPage({ organization, repository }: { organization: string; repository: string }) {
  const { account } = useSession();
  const detail = useAsyncData(() => fetchRepository(organization, repository), [organization, repository]);
  const loaded = detail.data;

  return (
    <RepositoryLayout
      organizationName={organization}
      repositoryName={repository}
      organizationDisplayName={loaded?.organization.displayName}
      activeSection="overview"
      canManage={loaded?.viewer.canManage ?? false}
      account={account}
      heading={
        <>
          <span className="repository-heading__path">
            {loaded ? `${loaded.organization.displayName}/${loaded.repository.name}` : repository}{" "}
          </span>
          {loaded ? (
            <span className="page-heading__identifier">{`${loaded.organization.name}/${loaded.repository.name}`}</span>
          ) : null}
        </>
      }
    >
      {detail.loading ? <p role="status">Loading repository…</p> : null}
      {detail.error ? (
        <p className="form-error" role="alert">
          {detail.error}
        </p>
      ) : null}
      {loaded ? (
        <dl className="repository-detail">
          <dt>Description</dt>
          <dd>{loaded.repository.description}</dd>
          <dt>Visibility</dt>
          <dd>{loaded.repository.visibility === "public" ? "Public" : "Private"}</dd>
          <dt>Updated</dt>
          <dd>{formatUpdatedAt(loaded.repository.updatedAt)}</dd>
        </dl>
      ) : null}
    </RepositoryLayout>
  );
}

import { OrganizationPeople } from "../components/OrganizationPeople";
import { OrganizationRepositories } from "../components/OrganizationRepositories";
import { OrganizationTeams } from "../components/OrganizationTeams";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { fetchOrganization } from "../lib/org-api";
import { organizationAuditLogHash, organizationHash, type OrganizationTab } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

const TABS: ReadonlyArray<readonly [OrganizationTab, string]> = [
  ["repositories", "Repositories"],
  ["people", "People"],
  ["teams", "Teams"],
];

/**
 * Public organization overview: the organization name is the heading and
 * Repositories / People / Teams are plain links (so they stay links even though
 * they are styled like tabs).
 */
export function OrganizationPage({
  organizationId,
  tab,
}: {
  organizationId: string;
  tab: OrganizationTab;
}) {
  const { status, data, error } = useAsyncData(
    () => fetchOrganization(organizationId),
    [organizationId],
  );

  if (status === "error" && error) {
    return (
      <main className="page">
        <section className="page__body organization">
          <ErrorHeading error={error} />
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="page__body organization">
        {data ? (
          <h1 className="organization__title">
            <span className="organization__name">{data.organization.displayName}</span>
            {data.organization.displayName === data.organization.id ? null : (
              <>
                {" "}
                <span className="organization__identifier">{data.organization.id}</span>
              </>
            )}
          </h1>
        ) : (
          <h1 className="organization__title">{organizationId}</h1>
        )}
        <nav className="page-tabs" aria-label="Organization">
          {TABS.map(([id, label]) => (
            <a
              key={id}
              className="page-tabs__link"
              href={organizationHash(organizationId, id)}
              aria-current={tab === id ? "page" : undefined}
            >
              {label}
            </a>
          ))}
          {data && data.viewerRole === "Owner" ? (
            <a className="page-tabs__link" href={organizationAuditLogHash(organizationId)}>
              Audit log
            </a>
          ) : null}
        </nav>
        {status === "loading" ? <LoadingNote label="Loading organization…" /> : null}
        {data && tab === "repositories" ? <OrganizationRepositories organizationId={organizationId} /> : null}
        {data && tab === "people" ? (
          <OrganizationPeople organizationId={organizationId} viewerRole={data.viewerRole} />
        ) : null}
        {data && tab === "teams" ? (
          <OrganizationTeams organizationId={organizationId} viewerRole={data.viewerRole} />
        ) : null}
      </section>
    </main>
  );
}

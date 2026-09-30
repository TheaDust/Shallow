import { NotFoundPage } from "./NotFoundPage";
import { organizationHref, type OrganizationTab } from "../lib/organization-routes";
import { OrganizationPeoplePanel } from "../organization/OrganizationPeoplePanel";
import { OrganizationRepositoriesPanel } from "../organization/OrganizationRepositoriesPanel";
import { OrganizationTeamsPanel } from "../organization/OrganizationTeamsPanel";
import { useOrganization } from "../organization/useOrganization";

const TABS: Array<{ id: OrganizationTab; label: string }> = [
  { id: "repositories", label: "Repositories" },
  { id: "people", label: "People" },
  { id: "teams", label: "Teams" },
];

export interface OrganizationPageProps {
  login: string;
  tab: OrganizationTab;
}

/**
 * Organization overview (REQ-2-1). The heading is the organization identifier,
 * the display name follows it and the "Repositories", "People" and "Teams"
 * entries are links even though they are styled as tabs. A visitor may open the
 * page of any existing organization and reads its public repositories only.
 */
export function OrganizationPage({ login, tab }: OrganizationPageProps) {
  const { state } = useOrganization(login);

  if (state.status === "loading") {
    return (
      <main aria-busy="true">
        <p role="status">Loading organization…</p>
      </main>
    );
  }

  if (state.status === "missing") return <NotFoundPage />;
  if (state.status === "error") {
    return (
      <main>
        <h1>Organization unavailable</h1>
        <p role="alert">The organization could not be loaded. Reload the page to try again.</p>
      </main>
    );
  }

  const { organization, viewer } = state;

  return (
    <main>
      <header className="organization-header">
        <h1 className="organization-header__name">{organization.login}</h1>
        <h2 className="organization-header__display-name">{organization.name}</h2>
        {viewer.role ? (
          <p className="organization-header__viewer-role">
            Your role: <span>{viewer.role === "owner" ? "Owner" : "Member"}</span>
          </p>
        ) : null}
      </header>
      <nav className="organization-tabs" aria-label="Organization">
        {TABS.map((entry) => (
          <a
            key={entry.id}
            href={organizationHref(organization.login, entry.id)}
            aria-current={entry.id === tab ? "page" : undefined}
          >
            {entry.label}
          </a>
        ))}
      </nav>
      {tab === "repositories" ? (
        <OrganizationRepositoriesPanel organization={organization} />
      ) : tab === "people" ? (
        <OrganizationPeoplePanel organization={organization} />
      ) : (
        <OrganizationTeamsPanel organization={organization} />
      )}
    </main>
  );
}

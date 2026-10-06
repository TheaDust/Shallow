import { AppHeader } from "../components/AppHeader";
import { ErrorNote, LoadingNote } from "../components/ViewState";
import { fetchYourOrganizations } from "../lib/org-api";
import { organizationHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/** Account-menu entry point: the signed-in account's organizations. */
export function YourOrganizationsPage() {
  const { status, data, error, reload } = useAsyncData(() => fetchYourOrganizations(), []);

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body organizations">
        <h1 className="organizations__title">Your organizations</h1>
        <p className="organizations__actions">
          <a className="ui-button ui-button--primary" href="#/settings/organizations/new">
            New organization
          </a>
        </p>
        {status === "loading" ? <LoadingNote label="Loading organizations…" /> : null}
        {status === "error" && error ? <ErrorNote error={error} onRetry={reload} /> : null}
        {status === "ready" && data ? (
          data.length === 0 ? (
            <p className="organizations__empty">You do not belong to any organizations yet.</p>
          ) : (
            <ul className="organization-list" aria-label="Your organizations">
              {data.map((organization) => (
                <li key={organization.id} className="organization-list__item">
                  <a className="organization-list__name" href={organizationHash(organization.id)}>
                    {organization.displayName}
                  </a>
                  {organization.role ? (
                    <span className="organization-list__role">{organization.role}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
    </main>
  );
}

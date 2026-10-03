import { useAuth } from "../../auth/AuthProvider";
import { SiteHeader } from "../../components/SiteHeader";
import { makeHash } from "../../lib/hash-route";
import { useAsyncData } from "../../lib/useAsyncData";
import { fetchOrganization } from "../../api/organizations";
import { PeoplePanel } from "./PeoplePanel";
import { RepositoriesPanel } from "./RepositoriesPanel";
import { TeamsPanel } from "./TeamsPanel";

export type OrganizationSection = "overview" | "repositories" | "people" | "teams";

const NAV_ENTRIES: Array<{ id: OrganizationSection; label: string; segment: string }> = [
  { id: "repositories", label: "Repositories", segment: "repositories" },
  { id: "people", label: "People", segment: "people" },
  { id: "teams", label: "Teams", segment: "teams" },
];

/**
 * Organization overview. The “Repositories”, “People” and “Teams” entries are
 * real navigation links (never tabs) even though they are styled as tabs, so
 * they keep link roles and their target URL is shareable.
 */
export function OrganizationPage({ slug, section }: { slug: string; section: OrganizationSection }) {
  const { account } = useAuth();
  const { data, error, loading } = useAsyncData(() => fetchOrganization(slug), [slug]);
  const activeSection = section === "overview" ? "repositories" : section;

  return (
    <main>
      <SiteHeader account={account} />
      <h1>{slug}</h1>
      {data && data.organization.displayName !== slug ? (
        <h2 className="organization__display-name">{data.organization.displayName}</h2>
      ) : null}
      <nav className="organization-nav" aria-label="Organization">
        {NAV_ENTRIES.map((entry) => (
          <a
            key={entry.id}
            className="organization-nav__link"
            href={makeHash(`/organizations/${slug}/${entry.segment}`)}
            aria-current={activeSection === entry.id ? "page" : undefined}
          >
            {entry.label}
          </a>
        ))}
      </nav>
      {loading ? <p role="status">Loading…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {activeSection === "repositories" ? (
        <RepositoriesPanel slug={slug} />
      ) : activeSection === "people" ? (
        <PeoplePanel slug={slug} />
      ) : (
        <TeamsPanel slug={slug} />
      )}
    </main>
  );
}

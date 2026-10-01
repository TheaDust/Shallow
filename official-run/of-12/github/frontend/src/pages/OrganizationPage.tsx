import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { useSession } from "../lib/session";
import { fetchOrganization, type OrganizationDetail } from "../features/organizations/org-api";
import { OrganizationPeople } from "../features/organizations/OrganizationPeople";
import { OrganizationRepositories } from "../features/organizations/OrganizationRepositories";
import { OrganizationTeams } from "../features/organizations/OrganizationTeams";
import { NotFoundPage } from "./NotFoundPage";

export type OrganizationTab = "repositories" | "people" | "teams";

export interface OrganizationPageProps {
  /** Organization identifier taken from the address; the detail response may spell it differently. */
  name: string;
  tab: OrganizationTab;
}

const TABS: Array<{ id: OrganizationTab; label: string }> = [
  { id: "repositories", label: "Repositories" },
  { id: "people", label: "People" },
  { id: "teams", label: "Teams" },
];

function isOrganizationTab(value: string): value is OrganizationTab {
  return TABS.some((tab) => tab.id === value);
}

export { isOrganizationTab };

type LoadState = "loading" | "ready" | "missing" | "failed";

/**
 * Organization overview (REQ-2-1): the organization identifier as the heading,
 * the Repositories/People/Teams navigation links (link roles even though they
 * are styled as tabs) and the tab content the current caller may see.
 */
export function OrganizationPage({ name, tab }: OrganizationPageProps) {
  const { user } = useSession();
  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    setState("loading");
    setDetail(null);
  }, [name]);

  useEffect(() => {
    let active = true;
    fetchOrganization(name)
      .then((result) => {
        if (!active) return;
        setDetail(result);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState(error instanceof ApiError && error.status === 404 ? "missing" : "failed");
      });
    return () => {
      active = false;
    };
  }, [name]);

  if (state === "missing") return <NotFoundPage />;

  const organizationName = detail?.organization.name ?? name;
  return (
    <main className="organization-page">
      <h1 className="organization-page__identifier">{organizationName}</h1>
      {detail ? (
        <h2 className="organization-page__display-name">{detail.organization.displayName}</h2>
      ) : (
        <p role="status">Loading organization…</p>
      )}
      {detail?.viewerRole ? (
        <p className="organization-page__role">
          You are a member of this organization with the {detail.viewerRole} role.
        </p>
      ) : null}

      <nav className="organization-page__tabs" aria-label="Organization">
        {TABS.map((entry) => (
          <a
            key={entry.id}
            className="organization-page__tab"
            href={`#/organizations/${organizationName}/${entry.id}`}
            aria-current={entry.id === tab ? "page" : undefined}
          >
            {entry.label}
          </a>
        ))}
      </nav>

      {state === "failed" ? (
        <p role="alert">The organization could not be loaded. Please try again.</p>
      ) : null}

      {tab === "repositories" ? (
        <OrganizationRepositories
          repositories={detail?.repositories ?? []}
          loading={state !== "ready"}
        />
      ) : null}

      {tab !== "repositories" && state !== "ready" ? (
        <section className="organization-page__panel" aria-label={tab === "people" ? "People" : "Teams"}>
          <p role="status">Loading organization…</p>
        </section>
      ) : null}

      {tab !== "repositories" && state === "ready" && !detail?.viewerRole ? (
        <section className="organization-page__panel" aria-label={tab === "people" ? "People" : "Teams"}>
          <p className="organization-page__restricted">
            Sign in as an organization member to view this list.{" "}
            <a href="#/sign-in">{user ? "Switch account" : "Sign in"}</a>
          </p>
        </section>
      ) : null}

      {tab === "people" && state === "ready" && detail?.viewerRole ? (
        <OrganizationPeople
          organization={detail.organization.name}
          members={detail.members}
          viewerRole={detail.viewerRole}
          loading={false}
          onMembersChange={(members) => setDetail((current) => (current ? { ...current, members } : current))}
        />
      ) : null}

      {tab === "teams" && state === "ready" && detail?.viewerRole ? (
        <OrganizationTeams
          organization={detail.organization.name}
          teams={detail.teams}
          viewerRole={detail.viewerRole}
          loading={false}
        />
      ) : null}
    </main>
  );
}

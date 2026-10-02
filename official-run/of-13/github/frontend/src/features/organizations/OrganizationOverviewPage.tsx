import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import { useDocumentTitle } from "../../lib/document-title";
import {
  fetchOrganization,
  fetchOrganizationMembers,
  fetchOrganizationRepositories,
  fetchOrganizationTeams,
  type OrganizationDetail,
  type OrganizationMember,
  type OrganizationTeam,
  type RepositorySummary,
} from "../../lib/organizations-api";
import { OrganizationPeoplePanel } from "./OrganizationPeoplePanel";
import { OrganizationRepositoriesPanel } from "./OrganizationRepositoriesPanel";
import { OrganizationTeamsPanel } from "./OrganizationTeamsPanel";
import { roleLabel } from "./format";

export interface OrganizationOverviewPageProps {
  organizationName: string;
  tab: string;
}

const TABS = [
  { id: "repositories", label: "Repositories" },
  { id: "people", label: "People" },
  { id: "teams", label: "Teams" },
] as const;

type LoadState = "loading" | "ready" | "missing" | "error";

/**
 * Public organization overview. The organization identifier is the page
 * heading, the Repositories/People/Teams entries are links, and every list is
 * loaded from the server already filtered for the current viewer.
 */
export function OrganizationOverviewPage({ organizationName, tab }: OrganizationOverviewPageProps) {
  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [teams, setTeams] = useState<OrganizationTeam[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  const activeTab = TABS.some((item) => item.id === tab) ? tab : "repositories";
  useDocumentTitle(organizationName);

  const load = useCallback(async () => {
    const organization = await fetchOrganization(organizationName);
    const [nextRepositories, nextMembers, nextTeams] = await Promise.all([
      fetchOrganizationRepositories(organizationName),
      fetchOrganizationMembers(organizationName),
      fetchOrganizationTeams(organizationName),
    ]);
    setDetail(organization);
    setRepositories(nextRepositories);
    setMembers(nextMembers);
    setTeams(nextTeams);
    setLoadState("ready");
  }, [organizationName]);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    load().catch((error) => {
      if (cancelled) return;
      setLoadState(error instanceof ApiError && error.status === 404 ? "missing" : "error");
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Member and team tabs read the authoritative server lists again after a write.
  const refresh = useCallback(() => {
    void load().catch(() => setLoadState("error"));
  }, [load]);

  const failed = loadState === "missing" || loadState === "error";

  return (
    <div className="organization-overview">
      <h1>{organizationName}</h1>
      {detail ? (
        <p className="organization-overview__display-name">{detail.organization.displayName}</p>
      ) : null}
      {detail?.viewerRole ? (
        <p className="organization-overview__role">{`Your role: ${roleLabel(detail.viewerRole)}`}</p>
      ) : null}
      <nav className="organization-tabs" aria-label="Organization">
        {TABS.map((item) => (
          <a
            key={item.id}
            className="organization-tabs__link"
            href={`#/organizations/${organizationName}?tab=${item.id}`}
            aria-current={activeTab === item.id ? "page" : undefined}
          >
            {item.label}
          </a>
        ))}
      </nav>
      {loadState === "missing" ? <p role="status">Organization not found.</p> : null}
      {loadState === "error" ? (
        <p className="form-error" role="alert">
          Unable to load this organization right now.
        </p>
      ) : null}
      {loadState === "loading" && activeTab !== "repositories" ? (
        <p role="status">Loading…</p>
      ) : null}
      {activeTab === "people" && loadState === "ready" ? (
        <OrganizationPeoplePanel
          organizationName={organizationName}
          members={members}
          canManage={detail?.viewerRole === "owner"}
          onChanged={refresh}
        />
      ) : null}
      {activeTab === "teams" && loadState === "ready" ? (
        <OrganizationTeamsPanel
          organizationName={organizationName}
          teams={teams}
          canManage={detail?.viewerRole === "owner"}
        />
      ) : null}
      {activeTab === "repositories" && !failed ? (
        <OrganizationRepositoriesPanel
          organizationName={organizationName}
          repositories={repositories}
          busy={loadState === "loading"}
        />
      ) : null}
    </div>
  );
}

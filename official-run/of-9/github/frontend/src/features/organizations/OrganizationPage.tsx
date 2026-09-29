import { useEffect, useState } from "react";

import { formatUpdatedTime } from "../../lib/format";
import { FormField } from "../../ui";
import {
  listRepositories,
  listTeams,
  getOrganization,
  type OrganizationOverview,
  type RepositoryInfo,
  type TeamInfo,
} from "./api";
import { PeopleTab } from "./PeopleTab";

export type OrganizationTab = "repositories" | "people" | "teams";

interface OrganizationPageProps {
  orgId: string;
  tab: OrganizationTab;
}

export function OrganizationPage({ orgId, tab }: OrganizationPageProps) {
  const [overview, setOverview] = useState<OrganizationOverview | null>(null);
  const [repositories, setRepositories] = useState<RepositoryInfo[] | null>(null);
  const [teams, setTeams] = useState<TeamInfo[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [filter, setFilter] = useState("");
  const [visibility, setVisibility] = useState<"all" | "public" | "private">("all");

  useEffect(() => {
    let cancelled = false;
    setOverview(null);
    getOrganization(orgId)
      .then((organization) => {
        if (!cancelled) setOverview(organization);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    if (tab !== "repositories") return;
    let cancelled = false;
    setRepositories(null);
    listRepositories(orgId)
      .then((list) => {
        if (!cancelled) setRepositories(list);
      })
      .catch(() => {
        if (!cancelled) setRepositories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, tab]);

  useEffect(() => {
    if (tab !== "teams") return;
    let cancelled = false;
    setTeams(null);
    listTeams(orgId)
      .then((list) => {
        if (!cancelled) setTeams(list);
      })
      .catch(() => {
        if (!cancelled) setTeams([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, tab]);

  if (notFound) {
    return (
      <section className="organization">
        <h1>Organization not found</h1>
      </section>
    );
  }
  if (!overview) {
    return (
      <p role="status" className="page-status">
        Loading…
      </p>
    );
  }

  const visibleRepositories = (repositories ?? []).filter((repository) => {
    const matchesName = repository.name.toLowerCase().includes(filter.trim().toLowerCase());
    const matchesVisibility =
      visibility === "all" || repository.visibility === visibility;
    return matchesName && matchesVisibility;
  });

  return (
    <section className="organization">
      <header className="organization__header">
        <h1 className="organization__heading">
          {overview.displayName}{" "}
          <span className="organization__id" aria-hidden="true">
            {overview.id}
          </span>
        </h1>
      </header>
      <nav className="org-tabs" aria-label="Organization">
        <a
          href={`#/orgs/${orgId}/repositories`}
          className={tab === "repositories" ? "org-tabs__tab org-tabs__tab--active" : "org-tabs__tab"}
          aria-current={tab === "repositories" ? "page" : undefined}
        >
          Repositories
        </a>
        <a
          href={`#/orgs/${orgId}/people`}
          className={tab === "people" ? "org-tabs__tab org-tabs__tab--active" : "org-tabs__tab"}
          aria-current={tab === "people" ? "page" : undefined}
        >
          People
        </a>
        <a
          href={`#/orgs/${orgId}/teams`}
          className={tab === "teams" ? "org-tabs__tab org-tabs__tab--active" : "org-tabs__tab"}
          aria-current={tab === "teams" ? "page" : undefined}
        >
          Teams
        </a>
      </nav>

      {tab === "repositories" ? (
        <div className="org-repositories">
          <div className="org-repositories__filters">
            <FormField id={`find-repository-${orgId}`} label="Find a repository">
              <input
                id={`find-repository-${orgId}`}
                type="text"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </FormField>
            <label className="org-repositories__visibility">
              <span>Visibility</span>
              <select
                value={visibility}
                onChange={(event) => setVisibility(event.target.value as "all" | "public" | "private")}
              >
                <option value="all">All</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </label>
          </div>
          {!repositories ? (
            <p role="status" className="page-status">
              Loading…
            </p>
          ) : visibleRepositories.length === 0 ? (
            <p className="org-repositories__empty">No repositories found.</p>
          ) : (
            <ul className="repo-list">
              {visibleRepositories.map((repository) => (
                <li key={repository.name} className="repo-list__item">
                  <a href={`#/repos/${orgId}/${repository.name}`} className="repo-list__name">
                    {repository.name}
                  </a>
                  {repository.description ? (
                    <p className="repo-list__description">{repository.description}</p>
                  ) : null}
                  <div className="repo-list__meta">
                    <span className="repo-list__visibility">
                      {repository.visibility === "public" ? "Public" : "Private"}
                    </span>
                    <span className="repo-list__updated">
                      Updated {formatUpdatedTime(repository.updatedAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === "people" ? (
        <PeopleTab orgId={orgId} isOwner={overview.myRole === "owner"} />
      ) : null}

      {tab === "teams" ? (
        <div className="org-teams">
          {overview.myRole === "owner" ? (
            <a className="ui-button ui-button--primary org-teams__new" href={`#/orgs/${orgId}/teams/new`}>
              New team
            </a>
          ) : null}
          {!teams ? (
            <p role="status" className="page-status">
              Loading…
            </p>
          ) : teams.length === 0 ? (
            <p className="org-teams__empty">No teams yet.</p>
          ) : (
            <ul className="teams-list">
              {teams.map((team) => (
                <li key={team.id} className="teams-list__item">
                  <a href={`#/orgs/${orgId}/teams/${team.name}`} className="teams-list__name">
                    {team.name}
                  </a>
                  <span className="teams-list__parent">
                    {team.parentName ? `Parent: ${team.parentName}` : "No parent"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

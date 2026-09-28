import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "../../components/AppHeader";
import {
  fetchOrganization,
  formatUpdateTime,
  listRepositories,
  listTeams,
  OrganizationSummary,
  RepositorySummary,
  TeamSummary,
} from "../../lib/org-api";
import { PeopleTab } from "./PeopleTab";

export type OrgTab = "repositories" | "people" | "teams";

/**
 * Organization overview: the organization identifier is the heading; the
 * Repositories, People and Teams entries are links styled as tabs. Repository
 * visibility is scoped server-side by the current session.
 */
export function OrganizationPage({ orgName, tab }: { orgName: string; tab: OrgTab }) {
  const [org, setOrg] = useState<OrganizationSummary | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOrg(null);
    setNotFound(false);
    fetchOrganization(orgName)
      .then((result) => {
        if (!cancelled) setOrg(result);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [orgName]);

  if (notFound) {
    return (
      <AppHeader>
        <main>
          <h1>{orgName}</h1>
          <p>Organization not found.</p>
        </main>
      </AppHeader>
    );
  }

  if (!org) {
    return (
      <AppHeader>
        <main>
          <p>Loading…</p>
        </main>
      </AppHeader>
    );
  }

  return (
    <AppHeader>
      <main>
        <h1>{org.name}</h1>
        <nav className="org-tabs" aria-label="Organization">
          <a
            className="org-tabs__link"
            href={`#/o/${org.name}`}
            aria-current={tab === "repositories" ? "page" : undefined}
          >
            Repositories
          </a>
          <a
            className="org-tabs__link"
            href={`#/o/${org.name}/people`}
            aria-current={tab === "people" ? "page" : undefined}
          >
            People
          </a>
          <a
            className="org-tabs__link"
            href={`#/o/${org.name}/teams`}
            aria-current={tab === "teams" ? "page" : undefined}
          >
            Teams
          </a>
        </nav>
        {tab === "repositories" && <RepositoriesTab orgName={org.name} />}
        {tab === "people" && <PeopleTab orgName={org.name} isOwner={org.role === "owner"} />}
        {tab === "teams" && <TeamsTab orgName={org.name} isOwner={org.role === "owner"} />}
      </main>
    </AppHeader>
  );
}

function RepositoriesTab({ orgName }: { orgName: string }) {
  const [repositories, setRepositories] = useState<RepositorySummary[] | null>(null);
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "public" | "private">("all");

  useEffect(() => {
    let cancelled = false;
    listRepositories(orgName)
      .then((result) => {
        if (!cancelled) setRepositories(result);
      })
      .catch(() => {
        if (!cancelled) setRepositories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgName]);

  const visible = useMemo(() => {
    const normalized = filter.trim().toLowerCase();
    return (repositories ?? []).filter((repository) => {
      if (normalized && !repository.name.toLowerCase().includes(normalized)) return false;
      if (typeFilter !== "all" && repository.visibility !== typeFilter) return false;
      return true;
    });
  }, [repositories, filter, typeFilter]);

  return (
    <section aria-label="Repositories">
      <div className="repo-filter">
        <div className="account-form__field">
          <label htmlFor="find-repository">Find a repository</label>
          <input
            id="find-repository"
            type="text"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="account-form__field">
          <label htmlFor="repo-type">Type</label>
          <select
            id="repo-type"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as "all" | "public" | "private")}
          >
            <option value="all">All</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </div>
      </div>
      {repositories === null ? (
        <p>Loading…</p>
      ) : visible.length === 0 ? (
        <p>No repositories found.</p>
      ) : (
        <ul className="repo-list">
          {visible.map((repository) => (
            <li key={repository.name} className="repo-list__item">
              <a href={`#/o/${orgName}/repos/${encodeURIComponent(repository.name)}`}>
                {repository.name}
              </a>
              {repository.description && <p className="repo-list__description">{repository.description}</p>}
              <p className="repo-list__meta">
                <span className="repo-list__visibility">{repository.visibility === "public" ? "Public" : "Private"}</span>
                <span>{formatUpdateTime(repository.updatedAt)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TeamsTab({ orgName, isOwner }: { orgName: string; isOwner: boolean }) {
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listTeams(orgName)
      .then((result) => {
        if (!cancelled) setTeams(result);
      })
      .catch(() => {
        if (!cancelled) setTeams([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgName]);

  if (teams === null) {
    return (
      <section aria-label="Teams">
        <p>Loading…</p>
      </section>
    );
  }

  const childrenByParent = new Map<string | null, TeamSummary[]>();
  for (const team of teams) {
    const key = team.parentTeamId;
    const list = childrenByParent.get(key) ?? [];
    list.push(team);
    childrenByParent.set(key, list);
  }

  function renderNode(team: TeamSummary): React.ReactNode {
    const children = childrenByParent.get(team.id) ?? [];
    return (
      <li key={team.id}>
        <a href={`#/o/${orgName}/teams/${encodeURIComponent(team.name)}`}>{team.name}</a>
        {team.parentName && <span className="team-tree__parent"> · parent: {team.parentName}</span>}
        {children.length > 0 && <ul className="team-tree__children">{children.map(renderNode)}</ul>}
      </li>
    );
  }

  return (
    <section aria-label="Teams">
      {isOwner && (
        <p>
          <a href={`#/o/${orgName}/teams/new`}>New team</a>
        </p>
      )}
      <ul className="team-tree">
        {(childrenByParent.get(null) ?? []).map(renderNode)}
      </ul>
    </section>
  );
}

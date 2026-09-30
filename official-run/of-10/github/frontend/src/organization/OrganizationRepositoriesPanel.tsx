import { useEffect, useState } from "react";

import {
  fetchOrganizationRepositories,
  type OrganizationSummary,
} from "../lib/organizations-api";
import { repositoryVisibilityLabel, type RepositorySummary } from "../lib/repositories-api";
import { repositoryOverviewHref } from "../lib/repository-routes";
import { FormField } from "../ui/FormField";

type VisibilityFilter = "all" | "public" | "private";

function formatUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return updatedAt;
  return date.toISOString().slice(0, 10);
}

function matchesFilter(
  repository: RepositorySummary,
  query: string,
  visibility: VisibilityFilter,
): boolean {
  if (visibility !== "all" && repository.visibility !== visibility) return false;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return repository.name.toLowerCase().includes(needle);
}

export interface OrganizationRepositoriesPanelProps {
  organization: OrganizationSummary;
}

/**
 * "Repositories" tab of the organization overview (REQ-2-1-1). The server
 * already removed every repository the viewer may not read, and the local filter
 * narrows the visible results while the user types without a submit action. The
 * list is read-only: name, description, visibility and update time only.
 */
export function OrganizationRepositoriesPanel({ organization }: OrganizationRepositoriesPanelProps) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<VisibilityFilter>("all");

  useEffect(() => {
    let active = true;
    setState("loading");
    fetchOrganizationRepositories(organization.login)
      .then(
        (results) => {
          if (!active) return;
          setRepositories(results);
          setState("ready");
        },
        () => {
          if (!active) return;
          setRepositories([]);
          setState("error");
        },
      );
    return () => {
      active = false;
    };
  }, [organization.login]);

  const visible = repositories.filter((repository) => matchesFilter(repository, query, visibility));

  return (
    <section
      className="organization-repositories"
      aria-labelledby="organization-repositories-heading"
    >
      <h2 id="organization-repositories-heading">Repositories</h2>
      <div className="organization-repositories__filters">
        <FormField id="organization-repository-filter" label="Find a repository">
          <input
            id="organization-repository-filter"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </FormField>
        <FormField id="organization-repository-visibility" label="Type">
          <select
            id="organization-repository-visibility"
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as VisibilityFilter)}
          >
            <option value="all">All</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </FormField>
      </div>
      {state === "loading" ? (
        <p role="status">Loading repositories…</p>
      ) : state === "error" ? (
        <p role="alert">The repositories could not be loaded. Reload the page to try again.</p>
      ) : visible.length === 0 ? (
        <p className="organization-repositories__empty">No repositories matched this filter.</p>
      ) : (
        <ul className="repository-list organization-repositories__list">
          {visible.map((repository) => (
            <li key={repository.id} className="repository-list__item">
              <article>
                <h3 className="repository-list__name">
                  <a href={repositoryOverviewHref(repository.owner.login, repository.name)}>
                    {repository.name}
                  </a>
                </h3>
                <p className="repository-list__full-name">{repository.fullName}</p>
                <p className="repository-list__description">{repository.description}</p>
                <p className="repository-list__meta">
                  <span className="visibility-badge" data-visibility={repository.visibility}>
                    {repositoryVisibilityLabel(repository.visibility)}
                  </span>
                  <span>
                    Updated{" "}
                    <time dateTime={repository.updatedAt}>{formatUpdatedAt(repository.updatedAt)}</time>
                  </span>
                </p>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

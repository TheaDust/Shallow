import { useState } from "react";

import type { RepositorySummary } from "./org-api";

export type RepositoryVisibilityFilter = "all" | "public" | "private";

export interface OrganizationRepositoriesProps {
  repositories: RepositorySummary[];
  loading: boolean;
}

/** Formats a repository update time for the read-only repository list. */
export function formatUpdatedAt(value: string | null | undefined): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function filterRepositories(
  repositories: RepositorySummary[],
  query: string,
  visibility: RepositoryVisibilityFilter,
): RepositorySummary[] {
  const needle = query.trim().toLowerCase();
  return repositories.filter((repository) => {
    if (visibility !== "all" && repository.visibility !== visibility) return false;
    return repository.name.toLowerCase().includes(needle);
  });
}

/**
 * Repositories tab of the organization overview (REQ-2-1-1).
 *
 * Read-only list of the repositories the current user may see; the filter box
 * narrows the visible results while typing and the visibility filter narrows
 * them by public/private, both without a submit action.
 */
export function OrganizationRepositories({ repositories, loading }: OrganizationRepositoriesProps) {
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<RepositoryVisibilityFilter>("all");
  const visible = filterRepositories(repositories, query, visibility);

  return (
    <section className="org-repositories" aria-label="Repositories">
      <div className="org-repositories__filters">
        <div className="ui-field">
          <label htmlFor="organization-repository-search">Find a repository</label>
          <input
            id="organization-repository-search"
            name="find-repository"
            type="text"
            placeholder="Find a repository…"
            value={query}
            disabled={loading}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="ui-field">
          <label htmlFor="organization-repository-type">Type</label>
          <select
            id="organization-repository-type"
            name="type"
            value={visibility}
            disabled={loading}
            onChange={(event) => setVisibility(event.target.value as RepositoryVisibilityFilter)}
          >
            <option value="all">All</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </div>
      </div>

      {loading ? <p role="status">Loading repositories…</p> : null}
      {!loading && visible.length === 0 ? (
        <p className="org-repositories__empty">No repositories matched your filters.</p>
      ) : null}

      <ul className="org-repositories__list">
        {visible.map((repository) => (
          <li
            key={repository.name}
            className="org-repositories__item"
            aria-label={`${repository.fullName} ${repository.visibility === "public" ? "Public" : "Private"}`}
          >
            <div className="org-repositories__heading">
              <a className="org-repositories__name" href={`#/${repository.owner}/${repository.name}`}>
                {repository.name}
              </a>
              <a
                className="org-repositories__full-name"
                href={`#/${repository.owner}/${repository.name}`}
              >
                {repository.fullName}
              </a>
              <span className="org-repositories__visibility">
                {repository.visibility === "public" ? "Public" : "Private"}
              </span>
            </div>
            {repository.description ? (
              <p className="org-repositories__description">{repository.description}</p>
            ) : null}
            <p className="org-repositories__updated">
              Updated {formatUpdatedAt(repository.updatedAt)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

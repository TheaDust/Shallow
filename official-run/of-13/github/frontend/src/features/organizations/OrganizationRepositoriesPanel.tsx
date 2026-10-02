import { useState } from "react";

import type { RepositorySummary, RepositoryVisibility } from "../../lib/organizations-api";
import { FormField } from "../../ui";
import { formatUpdatedAt, visibilityLabel } from "./format";

export interface OrganizationRepositoriesPanelProps {
  organizationName: string;
  repositories: RepositorySummary[];
  busy: boolean;
}

type VisibilityFilter = "all" | RepositoryVisibility;

/**
 * The "Repositories" tab: the visible repositories with a live name filter and
 * a public/private filter. Results only ever contain repositories the server
 * decided the current viewer may read, so typing a private name as a visitor
 * cannot reveal it.
 */
export function OrganizationRepositoriesPanel({
  organizationName,
  repositories,
  busy,
}: OrganizationRepositoriesPanelProps) {
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<VisibilityFilter>("all");

  const normalizedQuery = query.trim().toLowerCase();
  const visible = repositories.filter(
    (repository) =>
      (visibility === "all" || repository.visibility === visibility) &&
      (normalizedQuery.length === 0 || repository.name.toLowerCase().includes(normalizedQuery)),
  );

  return (
    <section className="organization-repositories" aria-label="Repositories">
      <div className="repository-filter">
        <FormField id="find-a-repository" label="Find a repository">
          <input
            id="find-a-repository"
            name="findRepository"
            type="text"
            autoComplete="off"
            disabled={busy}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </FormField>
        <FormField id="repository-visibility" label="Visibility">
          <select
            id="repository-visibility"
            name="visibility"
            disabled={busy}
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as VisibilityFilter)}
          >
            <option value="all">All</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </FormField>
      </div>
      {busy ? <p role="status">Loading…</p> : null}
      {!busy && visible.length === 0 ? <p role="status">No repositories found.</p> : null}
      <ul className="repository-list">
        {visible.map((repository) => (
          <li key={repository.name} className="repository-list__item">
            <h3 className="repository-list__name">
              <a href={`#/repositories/${organizationName}/${repository.name}`}>
                {repository.name}
              </a>
            </h3>
            {repository.description ? (
              <p className="repository-list__description">{repository.description}</p>
            ) : null}
            <p className="repository-list__meta">
              <span className="repository-list__visibility">
                {visibilityLabel(repository.visibility)}
              </span>
              <span className="repository-list__updated">
                Updated <time dateTime={repository.updatedAt}>{formatUpdatedAt(repository.updatedAt)}</time>
              </span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

import { useEffect, useState } from "react";

import { fetchOrganizationRepositories } from "./api";
import { formatUpdatedAt, visibilityLabel } from "./format";
import type { RepositorySummary, RepositoryVisibility } from "./types";
import { FormField } from "../ui";

type VisibilityFilter = "all" | RepositoryVisibility;

export interface OrganizationRepositoriesProps {
  slug: string;
}

/**
 * Repositories tab of an organization overview. The server already returns only
 * the repositories the current viewer may read; the textbox filter narrows the
 * visible results while the visitor types, with no submit action. Each result
 * links to the repository overview and shows its description, visibility and
 * update time, and the list offers no write operation.
 */
export function OrganizationRepositories({ slug }: OrganizationRepositoriesProps) {
  const [repositories, setRepositories] = useState<RepositorySummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<VisibilityFilter>("all");

  useEffect(() => {
    let cancelled = false;
    setRepositories(null);
    setFailed(false);
    fetchOrganizationRepositories(slug)
      .then((next) => {
        if (!cancelled) setRepositories(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const needle = query.trim().toLowerCase();
  const visible = (repositories ?? []).filter((repository) => (
    (needle.length === 0 || repository.name.toLowerCase().includes(needle))
    && (visibility === "all" || repository.visibility === visibility)
  ));

  const inputId = `find-repository-${slug}`;
  const selectId = `repository-visibility-${slug}`;

  return (
    <div className="org-repositories">
      <div className="org-repositories__filters">
        <FormField id={inputId} label="Find a repository">
          <input
            id={inputId}
            name="findRepository"
            type="search"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </FormField>
        <FormField id={selectId} label="Visibility">
          <select
            id={selectId}
            name="visibility"
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as VisibilityFilter)}
          >
            <option value="all">All</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </FormField>
      </div>
      {failed ? (
        <p className="org-repositories__error" role="alert">
          We could not load the repositories. Try again.
        </p>
      ) : null}
      {!failed && repositories === null ? <p role="status">Loading repositories…</p> : null}
      {repositories !== null ? (
        visible.length > 0 ? (
          <ul className="repository-list">
            {visible.map((repository) => (
              <li key={repository.name} className="repository-list__item">
                <a
                  className="repository-list__name"
                  href={`#/organizations/${slug}/repositories/${repository.name}`}
                >
                  {repository.name}
                </a>
                <p className="repository-list__description">{repository.description}</p>
                <p className="repository-list__meta">
                  <span className="repository-list__visibility">{visibilityLabel(repository.visibility)}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="repository-list__updated">Updated {formatUpdatedAt(repository.updatedAt)}</span>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="org-repositories__empty">No repositories match your filter.</p>
        )
      ) : null}
    </div>
  );
}
